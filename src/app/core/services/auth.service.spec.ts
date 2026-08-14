/**
 * Prueba del cliente PC-01 — AuthService
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Verifica que el servicio de autenticación guarde correctamente la sesión
 * y, sobre todo, que distinga las dos identidades de la plataforma: una
 * sesión de negocio (B2B) y una de cliente (B2C) no deben confundirse nunca,
 * porque de esa distinción dependen los guards que protegen cada zona.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';

describe('PC-01 · AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let router: Router;

  const API = 'http://localhost:8000/api/v1';

  const respuestaNegocio = {
    access_token: 'token-b2b-firmado',
    token_type: 'bearer',
    user_id: 'u_123',
    tenant_id: 't_456',
    role: 'business_admin',
    business_type: 'restaurant'
  };

  const respuestaCliente = {
    access_token: 'token-b2c-firmado',
    token_type: 'bearer',
    consumer_id: 'con_789'
  };

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    });
    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);

    // logout() redirige al login; se intercepta para no depender del enrutador real.
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('llama al endpoint correcto y guarda el token del negocio', () => {
    service.login({ email: 'admin@sabor-norteno.com', password: 'testpass123!' }).subscribe();

    const req = httpMock.expectOne(`${API}/auth/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body.email).toBe('admin@sabor-norteno.com');
    req.flush(respuestaNegocio);

    expect(service.getToken()).toBe('token-b2b-firmado');
  });

  it('guarda la sesión de negocio con su tenant y su rol', () => {
    service.login({ email: 'admin@sabor-norteno.com', password: 'testpass123!' }).subscribe();
    httpMock.expectOne(`${API}/auth/login`).flush(respuestaNegocio);

    const sesion = service.getSession();
    expect(sesion).not.toBeNull();
    expect(sesion!.tenant_id).toBe('t_456');
    expect(sesion!.role).toBe('business_admin');
    expect(sesion!.business_type).toBe('restaurant');
  });

  it('no confunde una sesión de cliente con una de negocio', () => {
    service.loginConsumer({ email: 'cliente@kard.dev', password: 'testpass123!' }).subscribe();
    httpMock.expectOne(`${API}/consumers/login`).flush(respuestaCliente);

    // getSession() es el accesor B2B: con una sesión de consumer debe dar null
    expect(service.getSession()).toBeNull();
    expect(service.isConsumer()).toBe(true);
  });

  it('reconoce una sesión de negocio como NO consumer', () => {
    service.login({ email: 'admin@sabor-norteno.com', password: 'testpass123!' }).subscribe();
    httpMock.expectOne(`${API}/auth/login`).flush(respuestaNegocio);

    expect(service.isConsumer()).toBe(false);
    expect(service.isLoggedIn()).toBe(true);
  });

  it('logout borra token y sesión', () => {
    service.login({ email: 'admin@sabor-norteno.com', password: 'testpass123!' }).subscribe();
    httpMock.expectOne(`${API}/auth/login`).flush(respuestaNegocio);

    service.logout();

    expect(service.getToken()).toBeNull();
    expect(service.getSession()).toBeNull();
    expect(service.isLoggedIn()).toBe(false);
  });
});
