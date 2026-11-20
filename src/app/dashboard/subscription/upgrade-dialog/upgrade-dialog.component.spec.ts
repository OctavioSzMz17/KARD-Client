/**
 * Flujo 15B, subir de plan (docs/Planes_contrato_frontend.md): vista previa
 * del prorrateo, confirmar con la misma proration_date, y qué pasa si el
 * banco no cobra la diferencia.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { ChangePlanPreview, PlanInfo } from '../../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../../core/plan-logic';
import { PlanNoticeService } from '../../../core/services/plan-notice.service';
import { SnackbarService } from '../../../core/services/snackbar.service';
import { UpgradeService } from '../../../core/services/upgrade.service';
import { PlanStore } from '../../../core/store/plan.store';
import { lockedNotice } from '../../../core/plan-notice.logic';
import { CheckoutDialogComponent } from '../checkout-dialog/checkout-dialog.component';
import { formatMoney, upgradeGains } from '../subscription-logic';
import { UpgradeDialogComponent } from './upgrade-dialog.component';

const API = environment.apiUrl;
const NOW = Date.now();

function info(over: Partial<PlanInfo> = {}): PlanInfo {
  return {
    plan: 'starter', subscription_status: 'active', current_period_end: '2026-12-01T00:00:00+00:00', has_access: true,
    has_subscription: true, access: DEV_PLAN_PRESETS['starter-pos'](NOW), usage: { products: 38, users: 2 },
    channel_change_available_at: null, ...over,
  };
}

const PREVIEW: ChangePlanPreview = {
  plan: 'pro', channel: null, direction: 'upgrade', charged_now: true, amount: '180.00', currency: 'mxn',
  proration_date: 1795000000, current_period_end: '2026-12-01T18:00:00+00:00',
};

describe('textos del flujo 15B', () => {
  it('lo que gana un Starter de POS: su tienda con sus productos, sin topes, envíos y descarga', () => {
    expect(upgradeGains('pro', info())).toEqual([
      'Tu tienda en línea se activa con tus 38 productos',
      'Productos y equipo sin límite',
      'Envíos a domicilio',
      'Reporte de ventas descargable',
    ]);
  });

  it('un Starter de tienda gana el mostrador', () => {
    const tienda = info({ access: DEV_PLAN_PRESETS['starter-tienda'](NOW) });
    expect(upgradeGains('pro', tienda)[0]).toBe('Cobra en el mostrador con el mismo inventario');
  });

  it('de Pro a Enterprise solo suma lo de Enterprise', () => {
    expect(upgradeGains('enterprise', info({ plan: 'pro', access: DEV_PLAN_PRESETS['pro'](NOW) }))).toEqual(['Varias sucursales', 'Soporte prioritario']);
  });

  it('un solo producto se dice en singular', () => {
    expect(upgradeGains('pro', info({ usage: { products: 1, users: 1 } }))[0]).toBe('Tu tienda en línea se activa con tu producto');
  });

  it('el dinero en pesos con dos decimales', () => {
    expect(formatMoney('180.00', 'mxn')).toBe('$180.00');
    expect(formatMoney('1199.5')).toBe('$1,199.50');
  });
});

describe('UpgradeDialogComponent', () => {
  let http: HttpTestingController;

  function abrir(target: 'pro' | 'enterprise' = 'pro') {
    const fixture = TestBed.createComponent(UpgradeDialogComponent);
    fixture.componentRef.setInput('target', target);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();
    return { f: fixture, closed, el: fixture.nativeElement as HTMLElement };
  }

  function conVistaPrevia(over: Partial<ChangePlanPreview> = {}) {
    const r = abrir();
    http.expectOne(`${API}/billing/plan`).flush(info());
    http.expectOne(r => r.url === `${API}/billing/change-plan/preview` && r.params.get('plan') === 'pro').flush({ ...PREVIEW, ...over });
    r.f.detectChanges();
    return r;
  }

  const boton = (el: HTMLElement) => el.querySelector('.dialog .primary') as HTMLButtonElement;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kard_token', 'token');
    localStorage.setItem('kard_user', JSON.stringify({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant',
      permissions: ['billing:manage'], plan: DEV_PLAN_PRESETS['starter-pos'](NOW),
    }));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('mientras calcula muestra un esqueleto', () => {
    const { el } = abrir();
    expect(el.querySelector('.skeleton')).not.toBeNull();
    expect(el.querySelector('h2')?.textContent).toBe('Pasa a Pro');
  });

  it('muestra lo que gana y lo que paga hoy, con la fecha de renovación', () => {
    const { el } = conVistaPrevia();
    expect(el.textContent).toContain('Tu tienda en línea se activa con tus 38 productos');
    expect(el.querySelector('.money')?.textContent).toContain('$180.00 hoy');
    expect(el.querySelector('.money')?.textContent).toContain('$599 al mes desde el 1 de diciembre');
    expect(boton(el).textContent?.trim()).toBe('Confirmar y pagar $180.00');
  });

  it('confirma con la MISMA proration_date y redibuja el menú con el access de la respuesta', () => {
    const { el, closed } = conVistaPrevia();
    const plan = TestBed.inject(PlanStore);
    const applied = TestBed.inject(UpgradeService).applied();
    expect(plan.hasStore()).toBe(false);

    boton(el).click();
    const req = http.expectOne(`${API}/billing/change-plan`);
    expect(req.request.body).toEqual({ plan: 'pro', proration_date: 1795000000 });
    req.flush({ status: 'applied', plan: 'pro', channel: 'pos', payment_url: null, access: DEV_PLAN_PRESETS['pro-desde-pos'](NOW) });

    expect(plan.hasStore()).toBe(true);
    expect(TestBed.inject(UpgradeService).applied()).toBe(applied + 1);
    expect(TestBed.inject(SnackbarService).messages()[0]?.message).toBe('Ya tienes Pro');
    expect(closed).toHaveBeenCalled();
  });

  it('payment_pending: el plan no cambia y ofrece pagar la diferencia en Stripe', () => {
    const { f, el, closed } = conVistaPrevia();
    const openTab = vi.spyOn(f.componentInstance, 'openTab').mockImplementation(() => {});
    boton(el).click();
    http.expectOne(`${API}/billing/change-plan`).flush({
      status: 'payment_pending', plan: 'starter', channel: 'pos', payment_url: 'https://invoice.stripe.test/i', access: DEV_PLAN_PRESETS['starter-pos'](NOW),
    });
    f.detectChanges();

    expect(el.querySelector('h2')?.textContent).toBe('No pudimos cobrar la diferencia');
    expect(el.textContent).toContain('Tu plan sigue igual');
    expect(TestBed.inject(PlanStore).hasStore()).toBe(false);

    boton(el).click();
    expect(openTab).toHaveBeenCalledWith('https://invoice.stripe.test/i');
    expect(closed).toHaveBeenCalled();
  });

  it('sin suscripción, subir es un primer pago: abre el flujo 15A con ese plan', () => {
    const { f } = abrir();
    http.expectOne(`${API}/billing/plan`).flush(info({ plan: null, has_subscription: false, subscription_status: 'none', access: DEV_PLAN_PRESETS['prueba'](NOW) }));
    f.detectChanges();
    http.expectNone(`${API}/billing/change-plan/preview`);
    const checkout = f.debugElement.query(d => d.componentInstance instanceof CheckoutDialogComponent);
    expect(checkout).not.toBeNull();
    expect((f.nativeElement as HTMLElement).querySelector('.resumen')?.textContent).toContain('Pro');
  });

  it('si la vista previa falla, lo dice y deja intentar de nuevo', () => {
    const { f, el } = abrir();
    http.expectOne(`${API}/billing/plan`).flush(info());
    http.expectOne(r => r.url.endsWith('/change-plan/preview')).flush({ success: false, error: 'Ya tienes ese plan.', code: 'same_plan' }, { status: 409, statusText: 'Conflict' });
    f.detectChanges();
    expect(el.textContent).toContain('Ya tienes ese plan.');

    boton(el).click();
    http.expectOne(`${API}/billing/plan`);
  });

  it('"Ver Pro" en un aviso abre este modal sin salir de la pantalla', () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl');
    const notices = TestBed.inject(PlanNoticeService);
    notices.show(lockedNotice('store', true));
    notices.run('upgrade');
    expect(TestBed.inject(UpgradeService).target()).toBe('pro');
    expect(navigate).not.toHaveBeenCalled();
  });
});
