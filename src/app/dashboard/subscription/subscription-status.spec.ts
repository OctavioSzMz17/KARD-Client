/**
 * Suscripción §14 A y B (docs/Planes_contrato_frontend.md): la tarjeta de
 * estado (el plan o la prueba, el estado en palabras y su fecha) y las barras
 * de uso de los topes de Starter.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { PlanInfo } from '../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../core/plan-logic';
import { UpgradeService } from '../../core/services/upgrade.service';
import { SubscriptionComponent } from './subscription.component';
import { formatLongDate, statusCard, usageBars } from './subscription-logic';

const API = environment.apiUrl;
const NOW = Date.now();
const preset = (n: string) => DEV_PLAN_PRESETS[n](NOW);

function info(over: Partial<PlanInfo> = {}): PlanInfo {
  return {
    plan: null, subscription_status: 'none', current_period_end: null, has_access: true, has_subscription: false,
    access: preset('prueba'), usage: { products: 12, users: 1 }, channel_change_available_at: null, ...over,
  };
}

const starterPos = (usage = { products: 38, users: 2 }, over: Partial<PlanInfo> = {}) => info({
  plan: 'starter', subscription_status: 'active', has_subscription: true, current_period_end: '2026-12-01T18:00:00+00:00',
  access: preset('starter-pos'), usage, ...over,
});

describe('statusCard (§14 A)', () => {
  it('en la prueba: "Prueba gratis", los días que quedan y cuándo termina', () => {
    const s = statusCard(info());
    expect(s).toMatchObject({ plan: 'Prueba gratis', state: 'Te quedan 18 días', dateLabel: 'Termina el', includes: null, tone: 'trial' });
    expect(s.date).toBe(formatLongDate(preset('prueba').trial_ends_at!));
  });

  it('la prueba por vencer se pinta como aviso', () => {
    expect(statusCard(info({ access: preset('prueba-por-vencer') })).tone).toBe('warning');
    expect(statusCard(info({ access: preset('prueba-ultimo-dia') })).state).toBe('Termina hoy');
  });

  it('Starter: el plan, la mitad que incluye y cuándo se renueva', () => {
    expect(statusCard(starterPos())).toEqual({
      plan: 'Starter', state: 'Activa', dateLabel: 'Se renueva el', date: '1 de diciembre de 2026', includes: 'Punto de venta', tone: 'ok',
    });
  });

  it('Pro no dice qué mitad incluye (tiene las dos)', () => {
    expect(statusCard(info({ plan: 'pro', subscription_status: 'active', has_subscription: true, access: preset('pro-desde-pos') })).includes).toBeNull();
  });

  it('pago atrasado: "Pago pendiente" y hasta cuándo está pagado', () => {
    expect(statusCard(starterPos(undefined, { subscription_status: 'past_due' }))).toMatchObject({
      state: 'Pago pendiente', dateLabel: 'Pagado hasta', tone: 'warning',
    });
  });

  it('vencida sin haber pagado, y cancelada', () => {
    expect(statusCard(info({ access: preset('vencido') }))).toMatchObject({ plan: 'Prueba gratis', state: 'Terminó', dateLabel: 'Terminó el', tone: 'danger' });
    expect(statusCard(info({ plan: 'starter', subscription_status: 'canceled', access: preset('cancelado') }))).toMatchObject({
      plan: 'Starter', state: 'Suscripción no activa', includes: 'Punto de venta', tone: 'danger', date: null,
    });
  });
});

describe('usageBars (§14 B)', () => {
  it('sin topes (prueba o Pro) no hay barras', () => {
    expect(usageBars(info())).toEqual([]);
    expect(usageBars(info({ plan: 'pro', access: preset('pro') }))).toEqual([]);
  });

  it('Starter: productos y equipo, con su porcentaje', () => {
    expect(usageBars(starterPos({ products: 20, users: 1 }))).toEqual([
      { label: 'Productos', used: 20, max: 50, percent: 40, tone: 'ok' },
      { label: 'Equipo', used: 1, max: 2, percent: 50, tone: 'ok' },
    ]);
  });

  it('ámbar desde el 80 % y rojo al llegar al tope', () => {
    const [productos, equipo] = usageBars(starterPos({ products: 40, users: 2 }));
    expect(productos.tone).toBe('warning');
    expect(equipo.tone).toBe('full');
  });

  it('por encima del tope (bajó de Pro) la barra se queda llena, no se desborda', () => {
    expect(usageBars(starterPos({ products: 62, users: 4 }))[0]).toMatchObject({ used: 62, percent: 100, tone: 'full' });
  });
});

describe('SubscriptionComponent: estado y uso', () => {
  let http: HttpTestingController;

  function abrir(estado: PlanInfo) {
    const fixture = TestBed.createComponent(SubscriptionComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/billing/plan`).flush(estado);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) } } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('la tarjeta dice "Prueba gratis" y no hay barras en la prueba', () => {
    const el = abrir(info());
    expect(el.querySelector('.estado-card')?.textContent).toContain('Prueba gratis');
    expect(el.querySelector('.estado-card')?.textContent).toContain('Te quedan 18 días');
    expect(el.querySelector('.uso-card')).toBeNull();
  });

  it('Starter muestra la mitad y las barras con "38 de 50"', () => {
    const el = abrir(starterPos());
    expect(el.querySelector('.estado-incluye')?.textContent).toContain('Punto de venta');
    const nums = [...el.querySelectorAll('.uso-num')].map(n => n.textContent?.trim());
    expect(nums).toEqual(['38 de 50', '2 de 2']);
    expect(el.querySelector('.uso.tone-full')?.textContent).toContain('Equipo');
  });

  it('cerca del tope ofrece Pro, y el botón abre el modal de mejora', () => {
    const el = abrir(starterPos({ products: 45, users: 1 }));
    expect(el.querySelector('.uso-pie')?.textContent).toContain('Pasa a Pro para quitar el límite');
    (el.querySelector('.uso-btn') as HTMLButtonElement).click();
    expect(TestBed.inject(UpgradeService).target()).toBe('pro');
  });

  it('lejos del tope no insiste', () => {
    const el = abrir(starterPos({ products: 10, users: 1 }));
    expect(el.querySelector('.uso-pie')).toBeNull();
  });
});
