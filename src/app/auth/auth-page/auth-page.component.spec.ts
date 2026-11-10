/**
 * Prueba del cliente PC-02 — AuthPageComponent
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Una sola pantalla sirve para entrar y registrarse, con un interruptor
 * Cliente / Negocio. Lo que se verifica es lo que no puede fallar:
 *   - el interruptor decide contra qué identidad se autentica, y NO se prueba
 *     la otra (antes el login adivinaba y aceptaba credenciales cruzadas);
 *   - nada viaja al servidor si el formulario es inválido;
 *   - cada registro llama a su endpoint con el cuerpo correcto;
 *   - los errores del servidor se muestran en español y sin ambigüedad.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { AuthPageComponent, AuthMode } from './auth-page.component';

describe('PC-02 · AuthPageComponent', () => {
  let httpMock: HttpTestingController;
  let router: Router;
  let component: AuthPageComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<AuthPageComponent>>;

  const API = 'http://localhost:8000/api/v1';

  function crear(mode: AuthMode, tipo?: string) {
    TestBed.configureTestingModule({
      imports: [AuthPageComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { queryParamMap: convertToParamMap(tipo ? { tipo } : {}) },
            paramMap: of(convertToParamMap({ mode })),
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture = TestBed.createComponent(AuthPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const llenar = (valores: Record<string, string>) => component.form.patchValue(valores);

  beforeEach(() => localStorage.clear());

  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
    vi.restoreAllMocks();
  });

  // ── Entrar ──────────────────────────────────────────────

  describe('iniciar sesión', () => {
    it('el formulario arranca inválido y no envía nada si está vacío', () => {
      crear('login');

      expect(component.form.invalid).toBe(true);
      component.onSubmit();

      httpMock.expectNone(() => true);
    });

    it('rechaza un correo con formato inválido sin llamar a la API', () => {
      crear('login');
      llenar({ email: 'no-es-correo', password: 'abc12345' });

      component.onSubmit();

      expect(component.emailControl?.errors?.['email']).toBeTruthy();
      httpMock.expectNone(() => true);
    });

    it('como cliente llama SOLO a /consumers/login y va a explorar', () => {
      crear('login', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345' });

      component.onSubmit();

      httpMock.expectNone(`${API}/auth/login`);
      httpMock.expectOne(`${API}/consumers/login`)
        .flush({ access_token: 't', token_type: 'bearer', consumer_id: 'con_1' });
      expect(router.navigate).toHaveBeenCalledWith(['/explore']);
    });

    it('como negocio llama SOLO a /auth/login y va al dashboard', () => {
      crear('login', 'negocio');
      llenar({ email: 'dueno@negocio.com', password: 'abc12345' });

      component.onSubmit();

      httpMock.expectNone(`${API}/consumers/login`);
      httpMock.expectOne(`${API}/auth/login`).flush({
        access_token: 't', token_type: 'bearer', user_id: 'u_1',
        tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant',
      });
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('un 401 como cliente NO reintenta como negocio y lo dice en español', () => {
      crear('login', 'cliente');
      llenar({ email: 'dueno@negocio.com', password: 'abc12345' });

      component.onSubmit();
      httpMock.expectOne(`${API}/consumers/login`)
        .flush({ error: 'Invalid email or password' }, { status: 401, statusText: 'Unauthorized' });

      httpMock.expectNone(`${API}/auth/login`);   // las credenciales de un negocio no sirven aquí
      expect(component.error()).toBe('Correo o contraseña incorrectos.');
      expect(component.loading()).toBe(false);
      expect(localStorage.getItem('kard_token')).toBeNull();
    });

    it('una cuenta bloqueada (403) muestra el aviso de bloqueo', () => {
      crear('login', 'negocio');
      llenar({ email: 'dueno@negocio.com', password: 'abc12345' });

      component.onSubmit();
      httpMock.expectOne(`${API}/auth/login`)
        .flush({ error: 'Account temporarily locked' }, { status: 403, statusText: 'Forbidden' });

      expect(component.error()).toContain('bloqueada');
    });
  });

  // ── Registrarse ─────────────────────────────────────────

  describe('crear cuenta', () => {
    it('cliente: contraseñas distintas no se envían', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345', confirmPassword: 'otra12345' });

      component.onSubmit();

      expect(component.form.hasError('passwordMismatch')).toBe(true);
      httpMock.expectNone(() => true);
    });

    it('cliente: llama a /consumers/register con el nombre solo si lo escribió', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345', confirmPassword: 'abc12345', name: '  Ana  ' });

      component.onSubmit();

      const req = httpMock.expectOne(`${API}/consumers/register`);
      expect(req.request.body).toEqual({ email: 'ana@correo.com', password: 'abc12345', name: 'Ana' });
      req.flush({ access_token: 't', token_type: 'bearer', consumer_id: 'con_1' });
      expect(router.navigate).toHaveBeenCalledWith(['/explore']);
    });

    it('cliente: sin nombre no manda el campo', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345', confirmPassword: 'abc12345' });

      component.onSubmit();

      const req = httpMock.expectOne(`${API}/consumers/register`);
      expect('name' in req.request.body).toBe(false);
      req.flush({ access_token: 't', token_type: 'bearer', consumer_id: 'con_1' });
    });

    it('negocio: exige el nombre del negocio', () => {
      crear('register', 'negocio');
      llenar({ email: 'dueno@negocio.com', password: 'abc12345', confirmPassword: 'abc12345' });

      component.onSubmit();

      expect(component.businessControl?.errors?.['required']).toBeTruthy();
      httpMock.expectNone(() => true);
    });

    it('negocio: llama a /auth/register-tenant (no al endpoint de admin) y entra al dashboard', () => {
      crear('register', 'negocio');
      llenar({
        business_name: '  Sabor Norteño ', business_type: 'optician',
        email: 'dueno@negocio.com', password: 'abc12345', confirmPassword: 'abc12345',
      });

      component.onSubmit();

      httpMock.expectNone(`${API}/saasadmin/tenants`);
      const req = httpMock.expectOne(`${API}/auth/register-tenant`);
      expect(req.request.body).toEqual({
        business_name: 'Sabor Norteño', business_type: 'optician',
        email: 'dueno@negocio.com', password: 'abc12345',
      });   // la confirmación no viaja
      req.flush({
        access_token: 't', token_type: 'bearer', user_id: 'u_1', tenant_id: 't_1',
        role: 'business_admin', business_type: 'optician', slug: 'sabor-norteno',
      });
      expect(router.navigate).toHaveBeenCalledWith(['/dashboard']);
    });

    it('la contraseña debe tener letras y números', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'soloLetrasAqui', confirmPassword: 'soloLetrasAqui' });

      component.onSubmit();

      expect(component.passwordControl?.invalid).toBe(true);
      httpMock.expectNone(() => true);
    });

    it('un correo ya registrado se explica en español', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345', confirmPassword: 'abc12345' });

      component.onSubmit();
      httpMock.expectOne(`${API}/consumers/register`)
        .flush({ error: 'Ese correo ya está registrado' }, { status: 400, statusText: 'Bad Request' });

      expect(component.error()).toContain('Ya existe una cuenta');
    });

    it('y sigue entendiendo el mensaje de un servidor que aún lo manda en inglés', () => {
      crear('register', 'cliente');
      llenar({ email: 'ana@correo.com', password: 'abc12345', confirmPassword: 'abc12345' });

      component.onSubmit();
      httpMock.expectOne(`${API}/consumers/register`)
        .flush({ error: 'Email is already registered' }, { status: 400, statusText: 'Bad Request' });

      expect(component.error()).toContain('Ya existe una cuenta');
    });
  });

  // ── El interruptor ──────────────────────────────────────

  describe('interruptor Cliente / Negocio', () => {
    it('sin pistas abre en Cliente', () => {
      crear('login');
      expect(component.audience()).toBe('cliente');
    });

    it('la URL manda sobre lo recordado', () => {
      localStorage.setItem('kard_auth_tipo', 'cliente');
      crear('login', 'negocio');
      expect(component.audience()).toBe('negocio');
    });

    it('sin URL se usa lo último que la persona eligió', () => {
      localStorage.setItem('kard_auth_tipo', 'negocio');
      crear('login');
      expect(component.audience()).toBe('negocio');
    });

    it('al cambiar de lado en el registro cambian los campos exigidos', () => {
      crear('register', 'cliente');
      expect(component.businessControl?.enabled).toBe(false);
      expect(component.nameControl?.enabled).toBe(true);

      component.setAudience('negocio');

      expect(component.businessControl?.enabled).toBe(true);
      expect(component.nameControl?.enabled).toBe(false);
      expect(localStorage.getItem('kard_auth_tipo')).toBe('negocio');
    });

    it('al cambiar de lado se limpia el error anterior', () => {
      crear('login', 'cliente');
      component.error.set('Correo o contraseña incorrectos.');

      component.setAudience('negocio');

      expect(component.error()).toBe('');
    });

    it('los textos cambian con el lado y con el modo', () => {
      crear('login', 'cliente');
      expect(component.title()).toBe('Bienvenido de nuevo');

      component.setAudience('negocio');
      expect(component.title()).toBe('Panel del negocio');
      expect(component.submitLabel()).toBe('Iniciar sesión');
    });
  });

  // ── ¿Olvidaste tu contraseña? ───────────────────────────

  describe('recuperar la contraseña', () => {
    const enlace = () =>
      Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('a'))
        .find(a => a.textContent?.includes('Olvidaste')) as HTMLAnchorElement | undefined;

    it('el enlace lleva a /recuperar con el lado elegido', () => {
      crear('login', 'negocio');
      expect(enlace()?.getAttribute('href')).toBe('/recuperar?tipo=negocio');
    });

    it('en el lado cliente lleva el lado cliente', () => {
      crear('login', 'cliente');
      expect(enlace()?.getAttribute('href')).toBe('/recuperar?tipo=cliente');
    });

    it('en el registro no aparece', () => {
      crear('register', 'negocio');
      expect(enlace()).toBeUndefined();
    });
  });
});
