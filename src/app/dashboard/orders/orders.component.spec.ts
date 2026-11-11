/**
 * La pantalla de Órdenes: los pedidos que hacen los clientes desde la tienda, en columnas.
 */

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { OrdersComponent } from './orders.component';
import { AuthService } from '../../core/services/auth.service';
import { OrdersBoardService } from '../../core/services/orders-board.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { PERM } from '../../core/permissions';
import { BoardSale, OrdersQueue } from '../../core/orders-board-logic';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;
const QUEUE = `${API}/orders/business/queue`;
const STATUS = (id: string) => `${API}/orders/business/sales/${id}/status`;

function sale(id: string, over: Partial<BoardSale> = {}): BoardSale {
  return {
    order_id: id, status: 'pending', fulfillment_type: 'pickup', fulfillment_status: 'preparing',
    total: '120.00', item_count: 2, customer_name: 'Ana López', created_at: new Date().toISOString(),
    items: [{ product_name: 'Chilaquiles', quantity: 2 }], ...over,
  };
}

function queue(...items: BoardSale[]): OrdersQueue {
  return { items, counts: {}, awaiting_payment: items.filter(s => s.status === 'pending').length };
}

describe('Pantalla de Órdenes', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<OrdersComponent>;
  let el: HTMLElement;

  const q = (sel: string) => el.querySelector(sel) as HTMLElement | null;
  const qa = (sel: string) => Array.from(el.querySelectorAll(sel)) as HTMLElement[];
  const boton = (texto: string) => qa('button').find(b => b.textContent?.trim() === texto);

  function abrir(permissions: string[], items: BoardSale[] | 'fallo' = []): void {
    TestBed.inject(AuthService).profile.set({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant',
      position: 'dueno', position_label: 'Dueño', full_name: 'Eva', employee_code: '0001', permissions,
    } as any);
    fixture = TestBed.createComponent(OrdersComponent);
    fixture.detectChanges();
    const req = http.expectOne(QUEUE);
    if (items === 'fallo') req.flush('x', { status: 500, statusText: 'Error' });
    else req.flush(queue(...items));
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthService).getToken = () => 'jwt';
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    TestBed.inject(OrdersBoardService).stop();
    fixture?.destroy();
    localStorage.clear();
  });

  describe('qué muestra', () => {
    it('sin pedidos explica que aquí llegan los de la tienda, no los del mostrador', () => {
      abrir([PERM.salesRead], []);
      expect(el.textContent).toContain('Aún no hay pedidos en línea');
      expect(el.textContent).toContain('mostrador');
    });

    it('un pedido nuevo cae en "Nuevas" con su cliente, su detalle y su total', () => {
      abrir([PERM.salesRead], [sale('ord_abc12345')]);
      const col = q('.column[data-state="preparing"]')!;
      expect(col.textContent).toContain('Nuevas');
      expect(col.textContent).toContain('Ana López');
      expect(col.textContent).toContain('Chilaquiles');
      expect(col.textContent).toContain('$120.00');
      expect(col.textContent).toContain('#12345');
    });

    it('cada pedido va en la columna de su estado', () => {
      abrir([PERM.salesRead], [
        sale('ord_a1111'), sale('ord_b2222', { fulfillment_status: 'ready', status: 'paid' }),
      ]);
      expect(q('.column[data-state="preparing"]')!.textContent).toContain('#A1111');
      expect(q('.column[data-state="ready"]')!.textContent).toContain('#B2222');
    });

    it('"En camino" solo aparece si hay algo en la calle', () => {
      abrir([PERM.salesRead], [sale('ord_a1111')]);
      expect(q('.column[data-state="in_transit"]')).toBeNull();
    });

    it('un pedido a domicilio muestra la dirección, el teléfono y las notas', () => {
      abrir([PERM.salesRead], [sale('ord_a1111', {
        fulfillment_type: 'delivery',
        shipping_address: { street: 'Calle 5 #12', neighborhood: 'Centro', city: 'Monterrey', phone: '8112345678', notes: 'Portón negro' },
      })]);
      const tarjeta = q('.card')!;
      expect(tarjeta.textContent).toContain('A domicilio');
      expect(tarjeta.textContent).toContain('Calle 5 #12');
      expect(tarjeta.textContent).toContain('Centro, Monterrey');
      expect(tarjeta.textContent).toContain('8112345678');
      expect(tarjeta.textContent).toContain('Portón negro');
    });

    it('un pedido en mesa dice qué mesa', () => {
      abrir([PERM.salesRead], [sale('ord_a1111', { fulfillment_type: 'dine_in', table_number: '7' })]);
      expect(q('.card')!.textContent).toContain('En mesa 7');
    });

    it('un pedido sin cobrar lo dice, y uno cobrado dice cómo se pagó', () => {
      abrir([PERM.salesRead], [
        sale('ord_a1111', { status: 'pending' }),
        sale('ord_b2222', { status: 'paid', payment_method: 'card' }),
      ]);
      const textos = qa('.pay').map(p => p.textContent!.replace(/\s+/g, ' ').trim());
      expect(textos).toContain('Sin cobrar');
      expect(textos).toContain('Pagado · Tarjeta');
    });

    it('un pedido que lleva mucho esperando se marca como tardado', () => {
      const hace = new Date(Date.now() - 45 * 60000).toISOString();
      abrir([PERM.salesRead], [sale('ord_a1111', { created_at: hace })]);
      expect(q('.card')!.classList.contains('late')).toBe(true);
      expect(q('.wait')!.textContent).toContain('tarda');
    });

    it('si falla la consulta lo dice y deja reintentar', () => {
      abrir([PERM.salesRead], 'fallo');
      expect(q('.banner')!.textContent).toContain('No pudimos actualizar');
      expect(boton('Reintentar')).toBeTruthy();
    });
  });

  describe('lo cerrado', () => {
    const cerrados = [
      sale('ord_c3333', { fulfillment_status: 'completed', status: 'paid' }),
      sale('ord_d4444', { status: 'canceled' }),
    ];

    it('queda plegado, con su conteo', () => {
      abrir([PERM.salesRead], cerrados);
      expect(q('.closed-toggle')!.textContent).toContain('2');
      expect(q('.closed-list')).toBeNull();
    });

    it('se despliega y distingue entregados de cancelados', () => {
      abrir([PERM.salesRead], cerrados);
      q('.closed-toggle')!.click();
      fixture.detectChanges();
      expect(q('.closed-list')!.textContent).toContain('Entregada');
      expect(q('.closed-list')!.textContent).toContain('Cancelada');
    });

    it('sin pedidos en marcha avisa que todo está al día', () => {
      abrir([PERM.salesRead], cerrados);
      expect(el.textContent).toContain('Todo al día');
    });
  });

  describe('mover pedidos', () => {
    const MANEJA = [PERM.salesRead, PERM.salesManage];

    it('quien solo puede ver las ventas no tiene botones para mover pedidos', () => {
      abrir([PERM.salesRead], [sale('ord_a1111')]);
      expect(boton('Marcar lista')).toBeUndefined();
      expect(boton('Marcar pagado')).toBeUndefined();
      expect(boton('Cancelar')).toBeUndefined();
    });

    it('"Marcar lista" pasa el pedido a listo', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      boton('Marcar lista')!.click();

      const req = http.expectOne(STATUS('ord_a1111'));
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ fulfillment_status: 'ready' });
      req.flush(sale('ord_a1111', { fulfillment_status: 'ready' }));
      http.expectOne(QUEUE).flush(queue(sale('ord_a1111', { fulfillment_status: 'ready' })));
      fixture.detectChanges();

      expect(q('.column[data-state="ready"]')!.textContent).toContain('Ana López');
      expect(boton('Entregada')).toBeTruthy();   // el siguiente paso ya es entregarla
    });

    it('un pedido a domicilio que está listo sale a la calle antes de entregarse', () => {
      abrir(MANEJA, [sale('ord_a1111', { fulfillment_type: 'delivery', fulfillment_status: 'ready', status: 'paid' })]);
      expect(boton('Salió a domicilio')).toBeTruthy();
      expect(boton('Entregada')).toBeUndefined();
    });

    it('"Marcar pagado" solo cambia el pago', () => {
      abrir(MANEJA, [sale('ord_a1111', { status: 'pending' })]);
      boton('Marcar pagado')!.click();

      const req = http.expectOne(STATUS('ord_a1111'));
      expect(req.request.body).toEqual({ status: 'paid' });
      req.flush(sale('ord_a1111', { status: 'paid' }));
      http.expectOne(QUEUE).flush(queue(sale('ord_a1111', { status: 'paid' })));
    });

    it('un pedido ya cobrado no ofrece "Marcar pagado"', () => {
      abrir(MANEJA, [sale('ord_a1111', { status: 'paid' })]);
      expect(boton('Marcar pagado')).toBeUndefined();
    });

    it('cancelar pide confirmación antes de mandar nada', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      boton('Cancelar')!.click();
      fixture.detectChanges();

      expect(el.textContent).toContain('¿Cancelar este pedido?');
      http.expectNone(STATUS('ord_a1111'));
    });

    it('"No" deja el pedido como estaba', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      boton('Cancelar')!.click();
      fixture.detectChanges();
      boton('No')!.click();
      fixture.detectChanges();

      expect(el.textContent).not.toContain('¿Cancelar este pedido?');
      http.expectNone(STATUS('ord_a1111'));
    });

    it('confirmar cancela pago y entrega a la vez', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      boton('Cancelar')!.click();
      fixture.detectChanges();
      boton('Sí, cancelar')!.click();

      const req = http.expectOne(STATUS('ord_a1111'));
      expect(req.request.body).toEqual({ status: 'canceled', fulfillment_status: 'canceled' });
      req.flush(sale('ord_a1111', { status: 'canceled' }));
      http.expectOne(QUEUE).flush(queue(sale('ord_a1111', { status: 'canceled' })));
    });

    it('un pedido cerrado se puede reabrir y vuelve a "Nuevas"', () => {
      abrir(MANEJA, [sale('ord_a1111', { fulfillment_status: 'completed', status: 'paid' })]);
      q('.closed-toggle')!.click();
      fixture.detectChanges();
      boton('Reabrir')!.click();

      const req = http.expectOne(STATUS('ord_a1111'));
      expect(req.request.body).toEqual({ fulfillment_status: 'preparing' });
      req.flush(sale('ord_a1111'));
      http.expectOne(QUEUE).flush(queue(sale('ord_a1111')));
    });

    it('un pedido cancelado no se puede reabrir: no tiene botón', () => {
      abrir(MANEJA, [sale('ord_a1111', { status: 'canceled' })]);
      q('.closed-toggle')!.click();
      fixture.detectChanges();

      expect(q('.closed-list')!.textContent).toContain('Cancelada');
      expect(boton('Reabrir')).toBeUndefined();
    });

    it('al cancelar avisa que los insumos vuelven al inventario', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      boton('Cancelar')!.click();
      fixture.detectChanges();
      expect(el.textContent).toContain('Los insumos vuelven al inventario');
    });

    it('si el servidor rechaza el movimiento, muestra su mensaje', () => {
      abrir(MANEJA, [sale('ord_a1111')]);
      const snack = TestBed.inject(SnackbarService);
      const errores: string[] = [];
      snack.error = ((m: string) => errores.push(m)) as typeof snack.error;

      boton('Marcar lista')!.click();
      http.expectOne(STATUS('ord_a1111')).flush(
        { code: 'ORDER_CANCELED', error: 'Un pedido cancelado no se puede reabrir: captura uno nuevo' },
        { status: 409, statusText: 'Conflict' },
      );

      expect(errores).toEqual(['Un pedido cancelado no se puede reabrir: captura uno nuevo']);
    });

    it('mientras se mueve un pedido no se puede pulsar otro botón', () => {
      abrir(MANEJA, [sale('ord_a1111'), sale('ord_b2222')]);
      boton('Marcar lista')!.click();
      fixture.detectChanges();

      expect(qa('.primary-btn').every(b => (b as HTMLButtonElement).disabled)).toBe(true);
      http.expectOne(STATUS('ord_a1111')).flush(sale('ord_a1111', { fulfillment_status: 'ready' }));
      http.expectOne(QUEUE).flush(queue(sale('ord_a1111', { fulfillment_status: 'ready' }), sale('ord_b2222')));
    });
  });
});
