/**
 * Prueba del cliente PC-22 — recuperar la contraseña por correo
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * Lo que se verifica es lo que no puede fallar:
 *   - el enlace del correo se lee del `#`; si está cortado o raro no se manda nada al servidor;
 *   - pedir el enlace llama al lado correcto (negocio / cliente) y la pantalla no delata si el
 *     correo existe: muestra siempre lo mismo;
 *   - la contraseña nueva sigue la misma regla del registro y no viaja si es débil o no coincide;
 *   - un enlace que el servidor rechaza manda a pedir otro, en vez de dejar reintentar en vano;
 *   - al terminar no se inicia sesión sola: la persona entra con la contraseña nueva.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { PasswordRecoveryComponent } from './password-recovery.component';
import { recoveryErrorMessage, tokenFromFragment } from './recovery-logic';

const API = 'http://localhost:8000/api/v1';
const TOKEN = 'abcdefghij0123456789_-ABCDEFGHIJ0123456789';

describe('PC-22 · recovery-logic', () => {
  describe('tokenFromFragment', () => {
    it('lee el token del fragmento, con o sin #', () => {
      expect(tokenFromFragment(`token=${TOKEN}`)).toBe(TOKEN);
      expect(tokenFromFragment(`#token=${TOKEN}`)).toBe(TOKEN);
    });

    it('sin fragmento o sin token → null', () => {
      expect(tokenFromFragment(null)).toBeNull();
      expect(tokenFromFragment(undefined)).toBeNull();
      expect(tokenFromFragment('')).toBeNull();
      expect(tokenFromFragment('otra=cosa')).toBeNull();
    });

    it('un token cortado o con caracteres raros → null', () => {
      expect(tokenFromFragment('token=abc')).toBeNull();
      expect(tokenFromFragment(`token=${TOKEN}<script>`)).toBeNull();
      expect(tokenFromFragment(`token=${'a'.repeat(201)}`)).toBeNull();
    });
  });

  describe('recoveryErrorMessage', () => {
    it('cada caso tiene su mensaje en español', () => {
      expect(recoveryErrorMessage(0)).toMatch(/conectar/);
      expect(recoveryErrorMessage(400, 'INVALID_RESET_TOKEN')).toMatch(/enlace ya no es válido/);
      expect(recoveryErrorMessage(422)).toMatch(/formato/);
      expect(recoveryErrorMessage(500)).toMatch(/de nuestro lado/);
      expect(recoveryErrorMessage(418)).toMatch(/No se pudo completar/);
    });
  });
});

describe('PC-22 · PasswordRecoveryComponent', () => {
  let httpMock: HttpTestingController;
  let component: PasswordRecoveryComponent;
  let fixture: ReturnType<typeof TestBed.createComponent<PasswordRecoveryComponent>>;

  function crear(mode: 'ask' | 'reset', opts: { fragment?: string | null; tipo?: string } = {}) {
    TestBed.configureTestingModule({
      imports: [PasswordRecoveryComponent],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              data: { mode },
              fragment: opts.fragment ?? null,
              queryParamMap: convertToParamMap(opts.tipo ? { tipo: opts.tipo } : {}),
            },
          },
        },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(PasswordRecoveryComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => localStorage.clear());
  afterEach(() => {
    httpMock.verify();
    localStorage.clear();
  });

  // ── Pedir el enlace ─────────────────────────────────────

  describe('pedir el enlace (/recuperar)', () => {
    it('arranca en el formulario y sin correo no envía nada', () => {
      crear('ask');
      expect(component.step()).toBe('form');

      component.onAsk();

      httpMock.expectNone(() => true);
      expect(component.emailControl.touched).toBe(true);
    });

    it('un correo con formato inválido no llega al servidor', () => {
      crear('ask');
      component.askForm.patchValue({ email: 'no-es-correo' });
      component.onAsk();
      httpMock.expectNone(() => true);
    });

    it('manda el correo (limpio) y el lado elegido', () => {
      crear('ask', { tipo: 'negocio' });
      component.askForm.patchValue({ email: '  eva@kard.mx ' });
      component.onAsk();

      const req = httpMock.expectOne(`${API}/auth/forgot-password`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ email: 'eva@kard.mx', audience: 'negocio' });
      req.flush({ message: 'Si ese correo está registrado, te enviamos un enlace.' });
    });

    it('el lado sale de ?tipo=, luego de lo último usado en el login, y por último cliente', () => {
      crear('ask', { tipo: 'cliente' });
      expect(component.audience()).toBe('cliente');
      TestBed.resetTestingModule();

      localStorage.setItem('kard_auth_tipo', 'negocio');
      crear('ask');
      expect(component.audience()).toBe('negocio');
      TestBed.resetTestingModule();

      localStorage.clear();
      crear('ask');
      expect(component.audience()).toBe('cliente');
    });

    it('el interruptor cambia el lado que viaja', () => {
      crear('ask', { tipo: 'cliente' });
      component.setAudience('negocio');
      component.askForm.patchValue({ email: 'eva@kard.mx' });
      component.onAsk();

      const req = httpMock.expectOne(`${API}/auth/forgot-password`);
      expect(req.request.body.audience).toBe('negocio');
      req.flush({ message: 'ok' });
    });

    it('tras pedirlo muestra "revisa tu correo", exista o no la cuenta (no delata nada)', () => {
      crear('ask');
      component.askForm.patchValue({ email: 'cualquiera@kard.mx' });
      component.onAsk();
      httpMock.expectOne(`${API}/auth/forgot-password`).flush({ message: 'Si ese correo está registrado, te enviamos un enlace.' });
      fixture.detectChanges();

      expect(component.step()).toBe('sent');
      expect(component.title()).toBe('Revisa tu correo');
      expect(texto()).toContain('Si ese correo está registrado');
      expect(component.loading()).toBe(false);
    });

    it('se puede pedir otro enlace sin salir de la pantalla', () => {
      crear('ask');
      component.askForm.patchValue({ email: 'eva@kard.mx' });
      component.onAsk();
      httpMock.expectOne(`${API}/auth/forgot-password`).flush({ message: 'ok' });

      component.askAgain();
      expect(component.step()).toBe('form');
    });

    it('si no hay conexión muestra el error y deja reintentar', () => {
      crear('ask');
      component.askForm.patchValue({ email: 'eva@kard.mx' });
      component.onAsk();
      httpMock.expectOne(`${API}/auth/forgot-password`).error(new ProgressEvent('error'), { status: 0 });

      expect(component.error()).toMatch(/conectar/);
      expect(component.step()).toBe('form');
      expect(component.loading()).toBe(false);
    });
  });

  // ── Contraseña nueva ────────────────────────────────────

  describe('contraseña nueva (/restablecer)', () => {
    it('sin token en la dirección, no hay formulario: pide un enlace nuevo', () => {
      crear('reset', { fragment: null });
      expect(component.step()).toBe('broken');
      expect(texto()).toContain('Pedir un enlace nuevo');
    });

    it('con el token cortado pasa lo mismo', () => {
      crear('reset', { fragment: 'token=abc' });
      expect(component.step()).toBe('broken');
    });

    it('con token, muestra el formulario', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      expect(component.step()).toBe('form');
      expect(component.title()).toBe('Crea tu contraseña nueva');
    });

    it('una contraseña débil no viaja', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      for (const mala of ['corta1', 'sinnumeroslargo', '123456789']) {
        component.resetForm.patchValue({ password: mala, confirm: mala });
        component.onReset();
      }
      httpMock.expectNone(() => true);
    });

    it('si no coinciden no viaja', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      component.resetForm.patchValue({ password: 'Clave12345', confirm: 'Clave54321' });
      component.onReset();
      httpMock.expectNone(() => true);
      expect(component.resetForm.hasError('passwordMismatch')).toBe(true);
    });

    it('manda el token y la contraseña nueva', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      component.resetForm.patchValue({ password: 'Clave12345', confirm: 'Clave12345' });
      component.onReset();

      const req = httpMock.expectOne(`${API}/auth/reset-password`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ token: TOKEN, password: 'Clave12345' });
      req.flush({ message: 'Listo' });

      expect(component.step()).toBe('done');
    });

    it('al terminar NO inicia sesión sola: ofrece ir a iniciar sesión', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      component.resetForm.patchValue({ password: 'Clave12345', confirm: 'Clave12345' });
      component.onReset();
      httpMock.expectOne(`${API}/auth/reset-password`).flush({ message: 'Listo' });
      fixture.detectChanges();

      expect(localStorage.getItem('kard_token')).toBeNull();
      const enlace = (fixture.nativeElement as HTMLElement).querySelector('a.btn-primary');
      expect(enlace?.textContent).toContain('Iniciar sesión');
      expect(enlace?.getAttribute('href')).toBe('/login');
    });

    it('un enlace que el servidor rechaza manda a pedir otro, no a reintentar', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      component.resetForm.patchValue({ password: 'Clave12345', confirm: 'Clave12345' });
      component.onReset();
      httpMock.expectOne(`${API}/auth/reset-password`)
        .flush({ success: false, code: 'INVALID_RESET_TOKEN', error: 'x' }, { status: 400, statusText: 'Bad Request' });
      fixture.detectChanges();

      expect(component.step()).toBe('broken');
      expect(texto()).toContain('Pedir un enlace nuevo');
    });

    it('otro error del servidor se muestra y se puede reintentar', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      component.resetForm.patchValue({ password: 'Clave12345', confirm: 'Clave12345' });
      component.onReset();
      httpMock.expectOne(`${API}/auth/reset-password`).flush({}, { status: 500, statusText: 'Server Error' });

      expect(component.step()).toBe('form');
      expect(component.error()).toMatch(/de nuestro lado/);
      expect(component.loading()).toBe(false);
    });

    it('el token no se queda en ningún almacenamiento', () => {
      crear('reset', { fragment: `token=${TOKEN}` });
      expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
      expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
    });
  });
});
