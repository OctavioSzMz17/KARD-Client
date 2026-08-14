/**
 * Prueba del cliente PC-03 — Guards de ruta
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Los guards son el espejo, en el enrutador, de la separación que el backend
 * impone en los tokens: un usuario de negocio no pertenece a las vistas de
 * cliente y un cliente no puede entrar al dashboard, aunque escriba la URL
 * a mano. Esta prueba verifica esa frontera en las cuatro combinaciones.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { authGuard, consumerGuard } from './auth.guard';

const TOKEN_KEY = 'kard_token';
const USER_KEY = 'kard_user';

/** Ejecuta un guard dentro del contexto de inyección de Angular. */
function correrGuard(guard: any): boolean {
  return TestBed.runInInjectionContext(() => guard({} as any, {} as any)) as boolean;
}

function sesionDeNegocio(): void {
  localStorage.setItem(TOKEN_KEY, 'token-b2b');
  localStorage.setItem(USER_KEY, JSON.stringify({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1',
    role: 'business_admin', business_type: 'restaurant'
  }));
}

function sesionDeCliente(): void {
  localStorage.setItem(TOKEN_KEY, 'token-b2c');
  localStorage.setItem(USER_KEY, JSON.stringify({ kind: 'consumer', consumer_id: 'con_1' }));
}

describe('PC-03 · Guards de ruta', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  describe('authGuard — protege el dashboard del negocio', () => {
    it('deja pasar a un usuario de negocio', () => {
      sesionDeNegocio();
      expect(correrGuard(authGuard)).toBe(true);
    });

    it('bloquea a un cliente y lo manda a explorar', () => {
      sesionDeCliente();

      expect(correrGuard(authGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/explore']);
    });

    it('bloquea a un anónimo y lo manda al login', () => {
      expect(correrGuard(authGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('consumerGuard — protege las vistas del cliente', () => {
    it('deja pasar a un cliente', () => {
      sesionDeCliente();
      expect(correrGuard(consumerGuard)).toBe(true);
    });

    it('bloquea a un usuario de negocio y lo devuelve a su dashboard', () => {
      sesionDeNegocio();

      expect(correrGuard(consumerGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('bloquea a un anónimo y lo manda al login', () => {
      expect(correrGuard(consumerGuard)).toBe(false);
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });
  });
});
