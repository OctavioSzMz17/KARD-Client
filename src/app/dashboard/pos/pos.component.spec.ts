/**
 * Prueba del cliente PC-13 — Entrar a Cobrar sin esperar autorización
 *
 * Quien inicia sesión con el login normal (un empleado en su celular o en cualquier
 * computadora) entra a su panel y cobra sin que nadie autorice su equipo. El equipo
 * autorizado solo existe para la pantalla de la caja registradora (/caja-registradora).
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PosComponent } from './pos.component';
import { AuthService } from '../../core/services/auth.service';
import { routes } from '../../app.routes';
import { PERM } from '../../core/permissions';
import { ProductStore } from '../../core/store/product.store';
import { SnackbarService } from '../../core/services/snackbar.service';
import { POLL_MS } from '../../core/ticket-sync-logic';
import { environment } from '../../../environments/environment';

function sesion(position: string, role = 'staff') {
  return {
    kind: 'b2b' as const, user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    position, position_label: position, full_name: 'Eva Prueba', employee_code: '0004',
    permissions: [PERM.posSell, PERM.productsRead, PERM.devicesUnlock],
  };
}

describe('PC-13 · Entrar a Cobrar sin esperar autorización', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function abrir(position: string, role?: string) {
    TestBed.inject(AuthService).profile.set(sesion(position, role) as any);
    const fixture = TestBed.createComponent(PosComponent);
    fixture.detectChanges();
    return { fixture, pos: fixture.componentInstance };
  }

  it.each([['empleado', 'staff'], ['encargado_area', 'staff'], ['subgerente', 'staff'], ['gerente', 'staff'], ['dueno', 'business_admin']])(
    '%s entra a Cobrar: nadie lo manda a autorizar el equipo',
    (puesto, rol) => {
      abrir(puesto, rol);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([['empleado', 'staff'], ['encargado_area', 'staff'], ['gerente', 'staff']])(
    '%s no ve ningún aviso de equipo no autorizado',
    (puesto, rol) => {
      const { fixture, pos } = abrir(puesto, rol);
      expect(pos.blocker() ?? '').not.toMatch(/autoriza/i);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toMatch(/equipo no es una caja/i);
    },
  );

  it('la ruta de Cobrar solo exige el permiso, no un equipo autorizado', () => {
    const dashboard = routes.find(r => r.path === 'dashboard')!;
    const cobrar = dashboard.children!.find(r => r.path === 'cobrar')!;
    expect(cobrar.canActivate).toHaveLength(1);
  });
});


// ═══════════════════════════════════════════════════════════════════
// PC-17 · Cobrar con el ticket compartido
// ═══════════════════════════════════════════════════════════════════

const API = environment.apiUrl;
const ES_CURRENT = (r: { url: string }) => r.url === `${API}/tickets/current`;
const ES_OPS = (r: { url: string }) => r.url === `${API}/tickets/ops`;
const ES_COBRO = (r: { url: string }) => r.url === `${API}/orders/business/sales`;

const UID = 'tk_a0000000000000001';

const producto = (id: string, price = '40.00') => ({
  product_id: id, name: `Producto ${id}`, description: '', price, inventory_count: 50, low_stock_threshold: 5,
  product_type: 'final', metadata: {}, images: [], is_deleted: false, sku: null, barcode: null,
});

describe('PC-17 · Cobrar con el ticket compartido', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  /** Abre Cobrar y contesta la primera consulta del ticket como si la sesión operara (o no) una caja. */
  function abrir(conCaja: boolean, lines: { product_id: string; quantity: number }[] = [], uid = UID) {
    TestBed.inject(AuthService).profile.set(sesion('empleado') as any);
    TestBed.inject(ProductStore).products.set([producto('p_1'), producto('p_2', '25.00')]);
    const fixture = TestBed.createComponent(PosComponent);
    fixture.detectChanges();
    http.expectOne(ES_CURRENT).flush(
      conCaja
        ? { register: { id: 'dv_1', name: 'Caja 1' }, ticket: { uid, rev: lines.length ? 1 : 0, lines } }
        : { register: null, ticket: null },
    );
    fixture.detectChanges();
    return { fixture, pos: fixture.componentInstance };
  }

  const cantidades = (pos: PosComponent) => Object.fromEntries(pos.cart().map(l => [l.product.product_id, l.quantity]));

  describe('lo que dice el servidor se ve en pantalla', () => {
    it('el ticket de la caja aparece al abrir Cobrar', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      expect(cantidades(pos)).toEqual({ p_1: 2 });
    });

    it('la lámpara dice a qué caja está conectado', () => {
      const { fixture } = abrir(true);
      const lampara = (fixture.nativeElement as HTMLElement).querySelector('.sync-chip');
      expect(lampara?.textContent).toContain('Caja 1');
      expect(lampara?.textContent).toContain('sincronizada');
    });

    it('sin caja no hay lámpara', () => {
      const { fixture } = abrir(false);
      expect((fixture.nativeElement as HTMLElement).querySelector('.sync-chip')).toBeNull();
    });

    it('lo que se escanea en el otro dispositivo aparece solo, sin tocar nada', () => {
      const { fixture, pos } = abrir(true);
      vi.advanceTimersByTime(POLL_MS);
      http.expectOne(ES_CURRENT).flush({
        register: { id: 'dv_1', name: 'Caja 1' },
        ticket: { uid: UID, rev: 1, lines: [{ product_id: 'p_2', quantity: 1 }] },
      });
      fixture.detectChanges();
      expect(cantidades(pos)).toEqual({ p_2: 1 });
    });

    it('si el otro dispositivo cobró o vació el ticket, aquí también queda vacío y se avisa', () => {
      const aviso = vi.spyOn(TestBed.inject(SnackbarService), 'info');
      const { fixture, pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      vi.advanceTimersByTime(POLL_MS);
      http.expectOne(ES_CURRENT).flush({
        register: { id: 'dv_1', name: 'Caja 1' },
        ticket: { uid: 'tk_b0000000000000002', rev: 2, lines: [] },
      });
      fixture.detectChanges();
      expect(pos.cart()).toEqual([]);
      expect(aviso).toHaveBeenCalledWith(expect.stringContaining('otro dispositivo'));
    });
  });

  describe('lo que se hace aquí se ve en el otro dispositivo', () => {
    it('agregar un producto se ve al instante y se manda al servidor', () => {
      const { pos } = abrir(true);
      pos.add(producto('p_2', '25.00') as any);

      expect(cantidades(pos)).toEqual({ p_2: 1 });
      const req = http.expectOne(ES_OPS);
      expect(req.request.body).toMatchObject({ type: 'add', product_id: 'p_2' });
    });

    it('subir la cantidad manda la cantidad nueva (no un "sumar uno")', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      pos.step(pos.cart()[0], 1);
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'set_quantity', product_id: 'p_1', quantity: 3 });
    });

    it('bajar la cantidad a cero quita la línea', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 1 }]);
      pos.step(pos.cart()[0], -1);
      expect(pos.cart()).toEqual([]);
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'remove', product_id: 'p_1' });
    });

    it('quitar una línea la quita también en el otro dispositivo', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }, { product_id: 'p_2', quantity: 1 }]);
      pos.remove(pos.cart()[0]);
      expect(cantidades(pos)).toEqual({ p_2: 1 });
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'remove', product_id: 'p_1' });
    });

    it('vaciar el ticket manda vaciar ESE ticket', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      pos.clearTicket();
      expect(pos.cart()).toEqual([]);
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'clear', uid: UID });
    });

    it('sin caja no se manda nada: el ticket es solo de esta pantalla', () => {
      const { pos } = abrir(false);
      pos.add(producto('p_1') as any);
      pos.step(pos.cart()[0], 1);
      http.expectNone(ES_OPS);
      expect(cantidades(pos)).toEqual({ p_1: 2 });
    });

    it('escanear con la cámara también llega al otro dispositivo', () => {
      const { pos } = abrir(true);
      pos.onScanned('p_1');                                   // el catálogo cargado lo encuentra por identificador
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'add', product_id: 'p_1' });
      expect(cantidades(pos)).toEqual({ p_1: 1 });
    });
  });

  describe('cobrar: la llave de idempotencia es la del ticket', () => {
    const cobrable = (pos: PosComponent) => {
      pos.session.set({ session_id: 'cs_1', status: 'open', opening_float: '0' } as any);
      pos.payment.set('card');
    };
    const venta = { order_id: 'o_1', items: [], total: '80.00', status: 'paid' };

    it('compartido: la llave es el identificador del ticket, el mismo para quien lo cobre', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      cobrable(pos);
      pos.charge();
      const req = http.expectOne(ES_COBRO);
      expect(req.request.headers.get('Idempotency-Key')).toBe(UID);
      expect(req.request.body.items).toEqual([{ product_id: 'p_1', quantity: 2 }]);
    });

    it('tras cobrar se vacía el ticket compartido, solo si sigue siendo ese', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 2 }]);
      cobrable(pos);
      pos.charge();
      http.expectOne(ES_COBRO).flush(venta);
      expect(http.expectOne(ES_OPS).request.body).toMatchObject({ type: 'clear', uid: UID });
      expect(pos.cart()).toEqual([]);
    });

    it('un cobro que falla y se reintenta usa la MISMA llave: si sí se había guardado, no se duplica', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 1 }]);
      cobrable(pos);
      pos.charge();
      http.expectOne(ES_COBRO).error(new ProgressEvent('error'), { status: 0 });
      pos.charge();
      expect(http.expectOne(ES_COBRO).request.headers.get('Idempotency-Key')).toBe(UID);
    });

    it('sin caja: tiene su propia llave, estable mientras el ticket sea el mismo', () => {
      const { pos } = abrir(false);
      pos.add(producto('p_1') as any);
      cobrable(pos);
      pos.charge();
      const primera = http.expectOne(ES_COBRO).request.headers.get('Idempotency-Key');
      expect(primera).toMatch(/^loc-[0-9a-f]{32}$/);
      expect(pos.ticketUid()).toBe(primera);
    });

    it('sin caja: el siguiente ticket estrena otra llave', () => {
      const { pos } = abrir(false);
      pos.add(producto('p_1') as any);
      cobrable(pos);
      const antes = pos.ticketUid();
      pos.charge();
      http.expectOne(ES_COBRO).flush(venta);
      expect(pos.ticketUid()).not.toBe(antes);
    });

    it('el otro dispositivo ya había cobrado el mismo ticket: llega la misma venta y aquí también se vacía', () => {
      const { pos } = abrir(true, [{ product_id: 'p_1', quantity: 1 }]);
      cobrable(pos);
      pos.charge();
      http.expectOne(ES_COBRO).flush(venta, { status: 200, statusText: 'OK' });
      expect(pos.receipt()?.order_id).toBe('o_1');
      expect(pos.cart()).toEqual([]);
    });
  });
});
