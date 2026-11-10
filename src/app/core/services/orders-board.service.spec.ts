/**
 * El tablero de órdenes en línea — consulta, aviso de pedidos nuevos y movimiento de estado.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OrdersBoardService } from './orders-board.service';
import { AuthService } from './auth.service';
import { SnackbarService } from './snackbar.service';
import { BoardSale, OrdersQueue } from '../orders-board-logic';
import { environment } from '../../../environments/environment';

const QUEUE = `${environment.apiUrl}/orders/business/queue`;

function sale(id: string, over: Partial<BoardSale> = {}): BoardSale {
  return {
    order_id: id, status: 'pending', fulfillment_type: 'pickup', fulfillment_status: 'preparing',
    total: '120.00', item_count: 1, customer_name: 'Ana', items: [{ product_name: 'Chilaquiles', quantity: 1 }],
    created_at: new Date().toISOString(), ...over,
  };
}

function queue(...items: BoardSale[]): OrdersQueue {
  const counts: OrdersQueue['counts'] = {};
  for (const s of items) counts[s.fulfillment_status as 'preparing'] = (counts[s.fulfillment_status as 'preparing'] ?? 0) + 1;
  return { items, counts, awaiting_payment: items.filter(s => s.status === 'pending').length };
}

describe('OrdersBoardService', () => {
  let http: HttpTestingController;
  let service: OrdersBoardService;
  let info: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthService).getToken = () => 'jwt-de-prueba';
    info = vi.fn();
    TestBed.inject(SnackbarService).info = info as unknown as SnackbarService['info'];
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(OrdersBoardService);
  });

  afterEach(() => {
    service.stop();
    http.verify();
    localStorage.clear();
  });

  it('pide el tablero con la sesión del negocio', () => {
    service.refresh();
    const req = http.expectOne(QUEUE);
    expect(req.request.method).toBe('GET');
    expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-prueba');
    req.flush(queue());
  });

  it('el contador del menú son los pedidos nuevos sin atender', () => {
    service.refresh();
    http.expectOne(QUEUE).flush(queue(sale('a'), sale('b'), sale('c', { fulfillment_status: 'ready' })));
    expect(service.pending()).toBe(2);
  });

  it('antes de la primera respuesta el contador es cero', () => {
    expect(service.pending()).toBe(0);
  });

  describe('avisar de pedidos nuevos', () => {
    it('la primera carga no avisa de lo que ya estaba', () => {
      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a'), sale('b')));
      expect(info).not.toHaveBeenCalled();
    });

    it('un pedido que llega después avisa con el nombre y el total', () => {
      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a')));

      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a'), sale('b', { customer_name: 'Luis', total: '250.00' })));

      expect(info).toHaveBeenCalledTimes(1);
      expect(info).toHaveBeenCalledWith('Nueva orden de Luis · $250.00');
    });

    it('varios a la vez se avisan juntos', () => {
      service.refresh();
      http.expectOne(QUEUE).flush(queue());

      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a'), sale('b'), sale('c')));
      expect(info).toHaveBeenCalledWith('3 órdenes nuevas');
    });

    it('el mismo pedido no se avisa dos veces', () => {
      service.refresh();
      http.expectOne(QUEUE).flush(queue());
      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a')));
      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a')));
      expect(info).toHaveBeenCalledTimes(1);
    });
  });

  describe('si falla la consulta', () => {
    it('marca el fallo y conserva lo que ya se veía', () => {
      service.refresh();
      http.expectOne(QUEUE).flush(queue(sale('a')));

      service.refresh();
      http.expectOne(QUEUE).flush('boom', { status: 500, statusText: 'Server Error' });

      expect(service.failed()).toBe(true);
      expect(service.queue()?.items).toHaveLength(1);
    });

    it('al recuperarse se quita el aviso', () => {
      service.refresh();
      http.expectOne(QUEUE).flush('boom', { status: 500, statusText: 'x' });
      service.refresh();
      http.expectOne(QUEUE).flush(queue());
      expect(service.failed()).toBe(false);
    });
  });

  describe('mover un pedido', () => {
    it('manda solo lo que cambia y vuelve a pedir el tablero', () => {
      service.move('ord_1', { fulfillment_status: 'ready' }).subscribe();
      const patch = http.expectOne(`${environment.apiUrl}/orders/business/sales/ord_1/status`);
      expect(patch.request.method).toBe('PATCH');
      expect(patch.request.body).toEqual({ fulfillment_status: 'ready' });
      patch.flush(sale('ord_1', { fulfillment_status: 'ready' }));

      http.expectOne(QUEUE).flush(queue(sale('ord_1', { fulfillment_status: 'ready' })));
      expect(service.pending()).toBe(0);
    });

    it('cancelar manda pago y entrega juntos', () => {
      service.move('ord_1', { status: 'canceled', fulfillment_status: 'canceled' }).subscribe();
      const patch = http.expectOne(`${environment.apiUrl}/orders/business/sales/ord_1/status`);
      expect(patch.request.body).toEqual({ status: 'canceled', fulfillment_status: 'canceled' });
      patch.flush(sale('ord_1', { status: 'canceled' }));
      http.expectOne(QUEUE).flush(queue());
    });

    it('si el servidor lo rechaza, no pide el tablero de nuevo', () => {
      let falló = false;
      service.move('ord_1', { status: 'paid' }).subscribe({ error: () => (falló = true) });
      http.expectOne(`${environment.apiUrl}/orders/business/sales/ord_1/status`)
        .flush('no', { status: 403, statusText: 'Forbidden' });
      expect(falló).toBe(true);
      http.expectNone(QUEUE);
    });
  });

  describe('el ciclo de consulta', () => {
    it('start pide el tablero y llamarlo otra vez no duplica la consulta', () => {
      service.start();
      service.start();
      http.expectOne(QUEUE).flush(queue());     // si hubiera dos, expectOne fallaría
      expect(service.running).toBe(true);
    });

    it('stop olvida lo del negocio: no queda nada al cerrar sesión', () => {
      service.start();
      http.expectOne(QUEUE).flush(queue(sale('a')));
      service.stop();

      expect(service.running).toBe(false);
      expect(service.queue()).toBeNull();
      expect(service.pending()).toBe(0);
    });

    it('tras stop, lo que ya estaba no se vuelve a avisar como nuevo', () => {
      service.start();
      http.expectOne(QUEUE).flush(queue(sale('a')));
      service.stop();

      service.start();
      http.expectOne(QUEUE).flush(queue(sale('a')));
      expect(info).not.toHaveBeenCalled();
    });
  });
});
