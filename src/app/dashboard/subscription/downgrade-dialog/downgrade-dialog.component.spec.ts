/**
 * Flujo 15C, bajar de plan (docs/Planes_contrato_frontend.md): elegir la mitad
 * (la de antes ya marcada), ver lo que pierde y que no se cobra nada hoy, y
 * confirmar con la misma proration_date.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { ChangePlanPreview, PlanInfo } from '../../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../../core/plan-logic';
import { SnackbarService } from '../../../core/services/snackbar.service';
import { UpgradeService } from '../../../core/services/upgrade.service';
import { PlanStore } from '../../../core/store/plan.store';
import { PLAN_CARDS, downgradeLosses } from '../subscription-logic';
import { DowngradeDialogComponent } from './downgrade-dialog.component';

const API = environment.apiUrl;
const NOW = Date.now();
const STARTER = PLAN_CARDS[0];
const PRO = PLAN_CARDS[1];

function info(over: Partial<PlanInfo> = {}): PlanInfo {
  return {
    plan: 'pro', subscription_status: 'active', current_period_end: '2026-12-01T00:00:00+00:00', has_access: true,
    has_subscription: true, access: DEV_PLAN_PRESETS['pro-desde-pos'](NOW), usage: { products: 62, users: 4 },
    channel_change_available_at: null, ...over,
  };
}

const PREVIEW: ChangePlanPreview = {
  plan: 'starter', channel: 'pos', direction: 'downgrade', charged_now: false, amount: '120.00', currency: 'mxn',
  proration_date: 1795000500, current_period_end: '2026-12-01T00:00:00+00:00',
};

const isPreview = (channel?: string) => (r: { url: string; params: { get(k: string): string | null } }) =>
  r.url === `${API}/billing/change-plan/preview` && r.params.get('plan') === 'starter' && r.params.get('channel') === (channel ?? null);

describe('downgradeLosses', () => {
  it('a Starter de POS, con más de lo que permite: lo dice con sus números y que nada se borra', () => {
    expect(downgradeLosses('starter', 'pos', info())).toEqual([
      'Tu tienda dejará de verse en línea y no recibirás pedidos',
      'No podrás agregar más de 50 productos (tienes 62; ninguno se borra)',
      'Tu equipo queda en 2 personas (tienes 4; nadie se da de baja, pero no podrás agregar ni reactivar)',
      'Se apagan los envíos a domicilio',
      'Ya no podrás descargar el reporte de ventas',
    ]);
  });

  it('a Starter de tienda pierde el mostrador, no las ventas', () => {
    expect(downgradeLosses('starter', 'store', info())[0]).toBe('El punto de venta deja de estar disponible; tus ventas y cortes no se borran');
  });

  it('dentro de los topes solo los menciona', () => {
    const chico = downgradeLosses('starter', 'pos', info({ usage: { products: 10, users: 1 } }));
    expect(chico).toContain('Hasta 50 productos');
    expect(chico).toContain('Hasta 2 personas en el equipo');
  });

  it('de Enterprise a Pro solo pierde lo de Enterprise', () => {
    expect(downgradeLosses('pro', null, info({ plan: 'enterprise' }))).toEqual(['Varias sucursales', 'Soporte prioritario']);
  });
});

describe('DowngradeDialogComponent', () => {
  let http: HttpTestingController;

  function abrir(card = STARTER, estado = info()) {
    const fixture = TestBed.createComponent(DowngradeDialogComponent);
    fixture.componentRef.setInput('card', card);
    fixture.componentRef.setInput('info', estado);
    const closed = vi.fn();
    fixture.componentInstance.closed.subscribe(closed);
    fixture.detectChanges();
    return { f: fixture, closed, el: fixture.nativeElement as HTMLElement };
  }

  const confirmar = (el: HTMLElement) => el.querySelector('.actions .neutral') as HTMLButtonElement;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kard_token', 'token');
    localStorage.setItem('kard_user', JSON.stringify({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant',
      permissions: ['billing:manage'], plan: DEV_PLAN_PRESETS['pro-desde-pos'](NOW),
    }));
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('marca la mitad que tenía antes de subir y pide la vista previa con ella', () => {
    const { f, el } = abrir();
    expect(el.querySelector('.mitad.selected')?.textContent).toContain('Punto de venta');
    http.expectOne(isPreview('pos')).flush(PREVIEW);
    f.detectChanges();
    expect(el.querySelector('.money')?.textContent).toContain('No se cobra nada hoy.');
    expect(el.querySelector('.money')?.textContent).toContain('$120.00');
    expect(el.textContent).toContain('tienes 62; ninguno se borra');
  });

  it('sin mitad previa, no deja confirmar hasta elegir una', () => {
    const { f, el } = abrir(STARTER, info({ access: DEV_PLAN_PRESETS['pro'](NOW) }));
    http.expectNone(r => r.url.endsWith('/change-plan/preview'));
    expect(el.querySelector('.mitad.selected')).toBeNull();
    expect(confirmar(el).disabled).toBe(true);

    (el.querySelectorAll('.mitad')[1] as HTMLButtonElement).click();
    http.expectOne(isPreview('store')).flush({ ...PREVIEW, channel: 'store' });
    f.detectChanges();
    expect(confirmar(el).disabled).toBe(false);
  });

  it('cambiar de mitad vuelve a pedir la vista previa', () => {
    const { el } = abrir();
    http.expectOne(isPreview('pos')).flush(PREVIEW);
    (el.querySelectorAll('.mitad')[1] as HTMLButtonElement).click();
    http.expectOne(isPreview('store'));
  });

  it('el botón de confirmar es neutro, no el dorado principal', () => {
    const { el } = abrir();
    expect(el.querySelector('.actions .primary')).toBeNull();
    expect(confirmar(el).textContent?.trim()).toBe('Cambiar a Starter');
    expect(el.querySelector('.actions .ghost')?.textContent?.trim()).toBe('Mantener Pro');
  });

  it('confirma con la mitad y la MISMA proration_date, y el menú se redibuja', () => {
    const { f, el, closed } = abrir();
    http.expectOne(isPreview('pos')).flush(PREVIEW);
    f.detectChanges();
    const applied = TestBed.inject(UpgradeService).applied();

    confirmar(el).click();
    const req = http.expectOne(`${API}/billing/change-plan`);
    expect(req.request.body).toEqual({ plan: 'starter', channel: 'pos', proration_date: 1795000500 });
    req.flush({ status: 'applied', plan: 'starter', channel: 'pos', payment_url: null, access: DEV_PLAN_PRESETS['starter-pos'](NOW) });

    expect(TestBed.inject(PlanStore).hasStore()).toBe(false);
    expect(TestBed.inject(UpgradeService).applied()).toBe(applied + 1);
    expect(TestBed.inject(SnackbarService).messages()[0]?.message).toBe('Tu plan ahora es Starter');
    expect(closed).toHaveBeenCalled();
  });

  it('de Enterprise a Pro no pide mitad', () => {
    const { el } = abrir(PRO, info({ plan: 'enterprise', access: DEV_PLAN_PRESETS['enterprise'](NOW) }));
    expect(el.querySelector('.mitades')).toBeNull();
    const req = http.expectOne(r => r.url.endsWith('/change-plan/preview'));
    expect(req.request.params.get('plan')).toBe('pro');
    expect(req.request.params.get('channel')).toBeNull();
  });

  it('si falla al confirmar, el modal sigue abierto y lo dice', () => {
    const { f, el, closed } = abrir();
    http.expectOne(isPreview('pos')).flush(PREVIEW);
    f.detectChanges();
    confirmar(el).click();
    http.expectOne(`${API}/billing/change-plan`).flush({ success: false, error: 'Stripe no respondió' }, { status: 503, statusText: 'x' });
    f.detectChanges();
    expect(el.querySelector('.confirm-error')?.textContent).toContain('Stripe no respondió');
    expect(closed).not.toHaveBeenCalled();
  });

  it('si la vista previa falla, deja intentar de nuevo', () => {
    const { f, el } = abrir();
    http.expectOne(isPreview('pos')).flush({ success: false, error: 'No se pudo' }, { status: 500, statusText: 'x' });
    f.detectChanges();
    expect(el.querySelector('.money.error')?.textContent).toContain('No se pudo');
    (el.querySelector('.link') as HTMLButtonElement).click();
    http.expectOne(isPreview('pos'));
  });
});
