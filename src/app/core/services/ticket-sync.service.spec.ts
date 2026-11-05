/**
 * Prueba del cliente PC-16 — TicketSyncService
 *
 * Lo que se escanea en el celular aparece en la computadora de la misma caja, y al revés, aunque
 * se vaya el internet: los cambios esperan en una fila y se reenvían con la misma llave. Aquí
 * se prueba el servicio con un servidor de mentira y el reloj controlado.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TicketSyncService } from './ticket-sync.service';
import { POLL_MS, TicketResponse, ops } from '../ticket-sync-logic';
import { environment } from '../../../environments/environment';

const CURRENT = `${environment.apiUrl}/tickets/current`;
const OPS = `${environment.apiUrl}/tickets/ops`;

const CAJA = { id: 'dv_1', name: 'Caja 1' };

const respuesta = (rev: number, lines: { product_id: string; quantity: number }[] = [], uid = 'tk_a0000000000000001'): TicketResponse => ({
  register: CAJA,
  ticket: { uid, rev, lines },
});

describe('PC-16 · TicketSyncService', () => {
  let http: HttpTestingController;
  let sync: TicketSyncService;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), TicketSyncService],
    });
    http = TestBed.inject(HttpTestingController);
    sync = TestBed.inject(TicketSyncService);
  });

  afterEach(() => {
    sync.stop();
    vi.useRealTimers();
    localStorage.clear();
  });

  /** Arranca y contesta la primera consulta como si la sesión operara la caja. */
  function conCaja(rev = 0, lines: { product_id: string; quantity: number }[] = []) {
    sync.start();
    http.expectOne(r => r.url === CURRENT).flush(respuesta(rev, lines));
  }

  const siguienteConsulta = () => {
    vi.advanceTimersByTime(POLL_MS);
    return http.expectOne(r => r.url === CURRENT);
  };

  describe('al arrancar', () => {
    it('pide el ticket completo, sin revisión que comparar', () => {
      sync.start();
      const req = http.expectOne(r => r.url === CURRENT);
      expect(req.request.params.has('since')).toBe(false);
      req.flush(respuesta(0));
    });

    it('una sesión que no opera caja se queda sin sincronizar y deja de preguntar', () => {
      sync.start();
      http.expectOne(r => r.url === CURRENT).flush({ register: null, ticket: null });

      expect(sync.enabled()).toBe(false);
      expect(sync.ready()).toBe(true);
      vi.advanceTimersByTime(POLL_MS * 5);
      http.expectNone(r => r.url === CURRENT);
    });

    it('con caja guarda su nombre y el ticket', () => {
      conCaja(3, [{ product_id: 'p_1', quantity: 2 }]);
      expect(sync.register()).toEqual(CAJA);
      expect(sync.ticket()).toEqual({ uid: 'tk_a0000000000000001', rev: 3, lines: [{ product_id: 'p_1', quantity: 2 }] });
      expect(sync.enabled()).toBe(true);
    });

    it('arrancar dos veces no duplica las consultas', () => {
      sync.start();
      sync.start();
      http.expectOne(r => r.url === CURRENT).flush(respuesta(0));
      http.expectNone(r => r.url === CURRENT);
    });
  });

  describe('leer lo que cambió en la otra pantalla', () => {
    it('pregunta otra vez cada segundo, ahora con la revisión y el ticket que ya tiene', () => {
      conCaja(4);
      const req = siguienteConsulta();
      expect(req.request.params.get('since')).toBe('4');
      expect(req.request.params.get('uid')).toBe('tk_a0000000000000001');
      req.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('un 204 no cambia nada', () => {
      conCaja(4, [{ product_id: 'p_1', quantity: 1 }]);
      siguienteConsulta().flush(null, { status: 204, statusText: 'No Content' });
      expect(sync.ticket()?.rev).toBe(4);
    });

    it('lo que escaneó el celular aparece al preguntar', () => {
      conCaja(4);
      siguienteConsulta().flush(respuesta(5, [{ product_id: 'p_9', quantity: 1 }]));
      expect(sync.ticket()?.lines).toEqual([{ product_id: 'p_9', quantity: 1 }]);
      expect(sync.ticket()?.rev).toBe(5);
    });

    it('si se vació o se cobró en la otra pantalla, llega el ticket nuevo con otro identificador', () => {
      conCaja(4, [{ product_id: 'p_1', quantity: 1 }]);
      siguienteConsulta().flush(respuesta(5, [], 'tk_b0000000000000002'));
      expect(sync.ticket()).toEqual({ uid: 'tk_b0000000000000002', rev: 5, lines: [] });
    });

    it('la lámpara se apaga si falla la consulta y se enciende cuando vuelve', () => {
      conCaja(0);
      siguienteConsulta().error(new ProgressEvent('error'));
      expect(sync.connected()).toBe(false);
      siguienteConsulta().flush(null, { status: 204, statusText: 'No Content' });
      expect(sync.connected()).toBe(true);
    });

    it('si esta sesión deja de operar la caja, el ticket vuelve a ser de la pantalla y avisa', () => {
      conCaja(2);
      siguienteConsulta().flush({ register: null, ticket: null });
      expect(sync.enabled()).toBe(false);
      expect(sync.ticket()).toBeNull();
      expect(sync.notice()?.text).toContain('ya no está operando la caja');
      vi.advanceTimersByTime(POLL_MS * 3);
      http.expectNone(r => r.url === CURRENT);
    });

    it('al detenerse no vuelve a preguntar', () => {
      conCaja(0);
      sync.stop();
      vi.advanceTimersByTime(POLL_MS * 5);
      http.expectNone(r => r.url === CURRENT);
    });
  });

  describe('mandar cambios', () => {
    it('manda la operación con su llave y toma el ticket que contesta el servidor', () => {
      conCaja(0);
      const op = ops.add('p_1');
      sync.send(op);

      const req = http.expectOne(OPS);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(op);
      req.flush(respuesta(1, [{ product_id: 'p_1', quantity: 1 }]));

      expect(sync.ticket()?.rev).toBe(1);
      expect(sync.pendingCount()).toBe(0);
    });

    it('sin caja no manda nada: el ticket se queda en la pantalla', () => {
      sync.start();
      http.expectOne(r => r.url === CURRENT).flush({ register: null, ticket: null });
      sync.send(ops.add('p_1'));
      http.expectNone(OPS);
      expect(sync.pendingCount()).toBe(0);                          // y tampoco se queda en la fila esperando para siempre
    });

    it('los cambios salen en orden, uno a la vez', () => {
      conCaja(0);
      const a = ops.add('p_1');
      const b = ops.add('p_2');
      const c = ops.remove('p_1');
      sync.send(a);
      sync.send(b);
      sync.send(c);

      expect(sync.pendingCount()).toBe(3);
      http.expectOne(OPS).flush(respuesta(1));
      expect(http.expectOne(OPS).request.body).toEqual(b);          // solo cuando llegó la respuesta de la primera
      http.expectNone(OPS);
    });

    it('un cambio enviado antes de saber si hay caja espera, y sale en cuanto se sabe', () => {
      sync.start();
      const op = ops.add('p_1');
      sync.send(op);
      http.expectNone(OPS);

      http.expectOne(r => r.url === CURRENT).flush(respuesta(0));
      expect(http.expectOne(OPS).request.body).toEqual(op);
    });

    it('y si resulta que no hay caja, ese cambio no se manda a ningún lado', () => {
      sync.start();
      sync.send(ops.add('p_1'));
      http.expectOne(r => r.url === CURRENT).flush({ register: null, ticket: null });
      http.expectNone(OPS);
      expect(sync.pendingCount()).toBe(0);
    });
  });

  describe('si se va el internet', () => {
    it('el cambio no se pierde: se queda en la fila y la lámpara avisa', () => {
      conCaja(0);
      sync.send(ops.add('p_1'));
      http.expectOne(OPS).error(new ProgressEvent('error'), { status: 0 });

      expect(sync.connected()).toBe(false);
      expect(sync.pendingCount()).toBe(1);
    });

    it('al volver la conexión se reenvía con LA MISMA llave', () => {
      conCaja(0);
      const op = ops.add('p_1');
      sync.send(op);
      http.expectOne(OPS).error(new ProgressEvent('error'), { status: 0 });

      vi.advanceTimersByTime(POLL_MS);
      const reintento = http.expectOne(OPS);
      expect(reintento.request.body.op_id).toBe(op.op_id);
      reintento.flush(respuesta(1, [{ product_id: 'p_1', quantity: 1 }]));

      expect(sync.pendingCount()).toBe(0);
      expect(sync.connected()).toBe(true);
      expect(sync.ticket()?.rev).toBe(1);
    });

    it('un error del servidor (500) también se reintenta', () => {
      conCaja(0);
      sync.send(ops.add('p_1'));
      http.expectOne(OPS).flush({}, { status: 503, statusText: 'Service Unavailable' });
      expect(sync.pendingCount()).toBe(1);
      vi.advanceTimersByTime(POLL_MS);
      http.expectOne(OPS).flush(respuesta(1));
      expect(sync.pendingCount()).toBe(0);
    });

    it('mientras hay cambios sin enviar no se pisa lo que se ve con lo que dice el servidor', () => {
      conCaja(0);
      sync.send(ops.add('p_1'));
      http.expectOne(OPS).error(new ProgressEvent('error'), { status: 0 });

      vi.advanceTimersByTime(POLL_MS);                              // el tick reintenta en vez de preguntar
      http.expectNone(r => r.url === CURRENT);
      expect(http.expectOne(OPS)).toBeTruthy();
    });

    it('varios cambios acumulados salen en orden al volver', () => {
      conCaja(0);
      const a = ops.add('p_1');
      const b = ops.add('p_2');
      sync.send(a);
      sync.send(b);
      http.expectOne(OPS).error(new ProgressEvent('error'), { status: 0 });

      vi.advanceTimersByTime(POLL_MS);
      const primero = http.expectOne(OPS);
      expect(primero.request.body.op_id).toBe(a.op_id);
      primero.flush(respuesta(1));
      expect(http.expectOne(OPS).request.body.op_id).toBe(b.op_id);
    });
  });

  describe('cuando el servidor rechaza un cambio', () => {
    it('un producto que no existe: se descarta, se avisa y se vuelve a pedir el ticket completo', () => {
      conCaja(0);
      sync.send(ops.add('p_9'));
      http.expectOne(OPS).flush({ code: 'PRODUCT_NOT_FOUND' }, { status: 404, statusText: 'Not Found' });

      expect(sync.pendingCount()).toBe(0);
      expect(sync.notice()?.text).toContain('no se puede agregar');
      const completo = http.expectOne(r => r.url === CURRENT);
      expect(completo.request.params.has('since')).toBe(false);
      completo.flush(respuesta(0));
    });

    it('ticket lleno: avisa', () => {
      conCaja(0);
      sync.send(ops.add('p_1'));
      http.expectOne(OPS).flush({ code: 'TICKET_FULL' }, { status: 409, statusText: 'Conflict' });
      expect(sync.notice()?.text).toContain('máximo');
      http.expectOne(r => r.url === CURRENT).flush(respuesta(0));
    });

    it('si ya no opera la caja, deja de sincronizar y el ticket vuelve a ser de la pantalla', () => {
      conCaja(0);
      sync.send(ops.add('p_1'));
      http.expectOne(OPS).flush({ code: 'NO_REGISTER' }, { status: 409, statusText: 'Conflict' });

      expect(sync.enabled()).toBe(false);
      expect(sync.pendingCount()).toBe(0);
      expect(sync.notice()?.text).toContain('ya no está operando la caja');
      vi.advanceTimersByTime(POLL_MS * 3);
      http.expectNone(r => r.url === CURRENT);
    });

    it('lo que sigue en la fila después de un rechazo sí se manda', () => {
      conCaja(0);
      sync.send(ops.add('p_9'));
      const buena = ops.add('p_1');
      sync.send(buena);
      http.expectOne(OPS).flush({}, { status: 404, statusText: 'Not Found' });
      expect(http.expectOne(OPS).request.body.op_id).toBe(buena.op_id);
    });
  });

  describe('orden de las respuestas', () => {
    it('una consulta que sale antes de mis cambios no los pisa cuando llega', () => {
      conCaja(1, [{ product_id: 'p_1', quantity: 1 }]);
      const consulta = siguienteConsulta();                          // sale con el ticket viejo…
      sync.send(ops.add('p_2'));                                      // …y yo cambio algo
      consulta.flush(respuesta(7, [{ product_id: 'p_7', quantity: 1 }]));   // llega la respuesta vieja, con otro contenido

      expect(sync.ticket()?.lines).toEqual([{ product_id: 'p_1', quantity: 1 }]);   // mientras mi cambio no se confirme, no se pisa nada
      expect(sync.ticket()?.rev).toBe(1);
      http.expectOne(OPS).flush(respuesta(2, [{ product_id: 'p_1', quantity: 1 }, { product_id: 'p_2', quantity: 1 }]));
      expect(sync.ticket()?.rev).toBe(2);
    });

    it('una consulta que salió antes y llega después de mi cambio ya confirmado se ignora', () => {
      conCaja(1);
      const consulta = siguienteConsulta();
      sync.send(ops.add('p_2'));
      http.expectOne(OPS).flush(respuesta(2, [{ product_id: 'p_2', quantity: 1 }]));
      consulta.flush(respuesta(1, []));                              // la vieja, tarde

      expect(sync.ticket()?.rev).toBe(2);
      expect(sync.ticket()?.lines).toEqual([{ product_id: 'p_2', quantity: 1 }]);
    });
  });

  describe('avisos', () => {
    it('cada aviso lleva su número, para poder repetir el mismo texto', () => {
      conCaja(0);
      sync.send(ops.add('p_9'));
      http.expectOne(OPS).flush({}, { status: 404, statusText: 'Not Found' });
      const primero = sync.notice()!.n;
      http.expectOne(r => r.url === CURRENT).flush(respuesta(0));

      sync.send(ops.add('p_9'));
      http.expectOne(OPS).flush({}, { status: 404, statusText: 'Not Found' });
      expect(sync.notice()!.n).toBeGreaterThan(primero);
    });
  });
});
