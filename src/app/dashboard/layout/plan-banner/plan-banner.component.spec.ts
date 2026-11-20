/**
 * Banner superior del panel (§11 de docs/Planes_contrato_frontend.md): un solo
 * aviso a la vez con el estado de la cuenta; el dueño ve qué hacer y el equipo,
 * que le avise al dueño.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../../environments/environment';
import { PlanAccess } from '../../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../../core/plan-logic';
import { AuthService } from '../../../core/services/auth.service';
import { PlanBannerComponent } from './plan-banner.component';
import { bannerFor } from './plan-banner.logic';

const API = environment.apiUrl;
const NOW = Date.now();
const preset = (name: string) => DEV_PLAN_PRESETS[name](NOW);

describe('bannerFor (§11)', () => {
  it('prueba con días de sobra: neutro, solo para el dueño', () => {
    expect(bannerFor(preset('prueba'), null, true)).toMatchObject({ tone: 'neutral', text: 'Prueba gratis: te quedan 18 días', action: 'Ver planes', fixed: false });
    expect(bannerFor(preset('prueba'), null, false)).toBeNull();
  });

  it('7 días o menos: amarillo, elegir plan', () => {
    expect(bannerFor(preset('prueba-por-vencer'), null, true)).toMatchObject({
      tone: 'warning', text: 'Tu prueba termina en 5 días. Elige un plan para no perder el acceso.', action: 'Elegir plan',
    });
    const equipo = bannerFor(preset('prueba-por-vencer'), null, false)!;
    expect(equipo).toMatchObject({ tone: 'warning', text: 'La prueba del negocio termina en 5 días. Avísale al dueño.' });
    expect(equipo.action).toBeUndefined();
  });

  it('último día: rojo', () => {
    expect(bannerFor(preset('prueba-ultimo-dia'), null, true)).toMatchObject({ tone: 'danger', text: 'Tu prueba termina hoy.' });
  });

  it('vencida sin plan previo: rojo fijo, sus datos están a salvo', () => {
    expect(bannerFor(preset('vencido'), null, true)).toMatchObject({
      tone: 'danger', fixed: true, action: 'Elegir plan',
      text: 'Tu prueba terminó. Tus datos están a salvo, pero no puedes vender ni editar.',
    });
  });

  it('canceló: rojo fijo, reactivar', () => {
    expect(bannerFor(preset('cancelado'), null, true)).toMatchObject({
      tone: 'danger', fixed: true, action: 'Reactivar', text: 'Tu suscripción no está activa. Tu tienda no se ve en línea.',
    });
  });

  it('el equipo en solo lectura: mismo color, avisarle al dueño, sin botón', () => {
    expect(bannerFor(preset('cancelado'), null, false)).toEqual({
      key: 'expired', tone: 'danger', fixed: true, text: 'La cuenta del negocio está en solo lectura. Avísale al dueño.',
    });
  });

  it('pago atrasado: amarillo, solo el dueño', () => {
    expect(bannerFor(preset('pro'), 'past_due', true)).toMatchObject({ tone: 'warning', action: 'Actualizar pago' });
    expect(bannerFor(preset('pro'), 'past_due', false)).toBeNull();
  });

  it('activa al día, o plan desconocido: sin banner', () => {
    expect(bannerFor(preset('pro'), 'active', true)).toBeNull();
    expect(bannerFor(null, null, true)).toBeNull();
  });
});

describe('PlanBannerComponent', () => {
  let http: HttpTestingController;

  function abrir(plan: PlanAccess, owner = true) {
    TestBed.inject(AuthService).profile.set({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: owner ? 'business_admin' : 'staff', business_type: 'restaurant',
      permissions: owner ? ['billing:manage', 'pos:sell'] : ['pos:sell'], plan,
    });
    const fixture = TestBed.createComponent(PlanBannerComponent);
    fixture.detectChanges();
    return { f: fixture, el: fixture.nativeElement as HTMLElement };
  }

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('el dueño ve el aviso con su botón a Suscripción', () => {
    const { el } = abrir(preset('prueba-por-vencer'));
    expect(el.querySelector('.plan-banner')?.classList).toContain('tone-warning');
    const action = el.querySelector('a.action') as HTMLAnchorElement;
    expect(action.textContent?.trim()).toBe('Elegir plan');
    expect(action.getAttribute('href')).toBe('/dashboard/suscripcion');
  });

  it('se puede cerrar y no vuelve en la sesión; si cambian los días, sí', () => {
    const { f, el } = abrir(preset('prueba-por-vencer'));
    (el.querySelector('.close') as HTMLButtonElement).click();
    f.detectChanges();
    expect(el.querySelector('.plan-banner')).toBeNull();

    const auth = TestBed.inject(AuthService);
    auth.profile.set({ ...auth.profile()!, plan: { ...preset('prueba-por-vencer'), trial_days_left: 4 } });
    f.detectChanges();
    expect(el.querySelector('.plan-banner')?.textContent).toContain('4 días');
  });

  it('vencida: fijo, sin botón de cerrar', () => {
    const { el } = abrir(preset('vencido'));
    expect(el.querySelector('.close')).toBeNull();
    expect(el.textContent).toContain('Tu prueba terminó');
  });

  it('el dueño con la cuenta activa pregunta una vez el estado de Stripe para avisar del pago atrasado', () => {
    const { f, el } = abrir(preset('pro'));
    expect(el.querySelector('.plan-banner')).toBeNull();
    http.expectOne(`${API}/billing/plan`).flush({ subscription_status: 'past_due' });
    f.detectChanges();
    expect(el.textContent).toContain('No pudimos cobrar tu renovación');
    expect(el.querySelector('a.action')?.textContent?.trim()).toBe('Actualizar pago');
  });

  it('el equipo nunca pide el estado de Stripe', () => {
    abrir(preset('pro'), false);
    http.expectNone(`${API}/billing/plan`);
  });

  it('en la prueba no se pregunta a Stripe', () => {
    abrir(preset('prueba'));
    http.expectNone(`${API}/billing/plan`);
  });
});
