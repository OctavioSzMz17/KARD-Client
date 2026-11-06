/**
 * Prueba del cliente PC-21 — SalesService (estadísticas y llave del cobro)
 *
 * Las estadísticas del Dashboard se piden con el desfase de la zona horaria del navegador, para
 * que "hoy" sea el día del negocio; y el cobro manda la llave de idempotencia solo si hay una.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SalesService } from './sales.service';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

describe('PC-21 · SalesService', () => {
  let http: HttpTestingController;
  let service: SalesService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    TestBed.inject(AuthService).getToken = () => 'jwt-de-prueba';
    http = TestBed.inject(HttpTestingController);
    service = TestBed.inject(SalesService);
  });

  afterEach(() => {
    http.verify();
    localStorage.clear();
  });

  describe('estadísticas', () => {
    it('pide los últimos 7 días por defecto', () => {
      service.stats().subscribe();
      const req = http.expectOne(r => r.url === `${API}/orders/business/stats`);
      expect(req.request.method).toBe('GET');
      expect(req.request.params.get('days')).toBe('7');
      req.flush({});
    });

    it('manda el desfase de la zona horaria del navegador (no una constante)', () => {
      service.stats(7).subscribe();
      const req = http.expectOne(r => r.url === `${API}/orders/business/stats`);
      expect(req.request.params.get('tz_offset')).toBe(String(new Date().getTimezoneOffset()));
      req.flush({});
    });

    it('acepta otro número de días', () => {
      service.stats(14).subscribe();
      const req = http.expectOne(r => r.url === `${API}/orders/business/stats`);
      expect(req.request.params.get('days')).toBe('14');
      req.flush({});
    });

    it('va con la sesión del negocio, sin mandar el negocio (sale del token)', () => {
      service.stats().subscribe();
      const req = http.expectOne(r => r.url === `${API}/orders/business/stats`);
      expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-prueba');
      expect(req.request.params.has('tenant_id')).toBe(false);
      req.flush({});
    });
  });

  describe('cobrar', () => {
    const cuerpo = { items: [{ product_id: 'p_1', quantity: 1 }], payment_method: 'card' as const, fulfillment_type: 'takeaway' as const };

    it('con llave, la manda en la cabecera Idempotency-Key', () => {
      service.charge(cuerpo, 'tk_a0000000000000001').subscribe();
      const req = http.expectOne(`${API}/orders/business/sales`);
      expect(req.request.headers.get('Idempotency-Key')).toBe('tk_a0000000000000001');
      expect(req.request.headers.get('Authorization')).toBe('Bearer jwt-de-prueba');
      req.flush({});
    });

    it('sin llave, no manda la cabecera (compatibilidad)', () => {
      service.charge(cuerpo).subscribe();
      const req = http.expectOne(`${API}/orders/business/sales`);
      expect(req.request.headers.has('Idempotency-Key')).toBe(false);
      req.flush({});
    });
  });
});
