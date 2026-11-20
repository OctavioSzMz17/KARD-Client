/**
 * Suscripción: flujo 15A (primer pago) de docs/Planes_contrato_frontend.md.
 * Starter pide la mitad, Pro va directo al resumen, y al volver de Stripe la
 * pantalla espera a que el webhook active el plan.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../environments/environment';
import { PlanInfo } from '../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../core/plan-logic';
import { SnackbarService } from '../../core/services/snackbar.service';
import { CheckoutDialogComponent } from './checkout-dialog/checkout-dialog.component';
import { SubscriptionComponent } from './subscription.component';
import { PLAN_CARDS, isCurrentPlan, planButton } from './subscription-logic';

const API = environment.apiUrl;
const STARTER = PLAN_CARDS[0];
const PRO = PLAN_CARDS[1];
const ENTERPRISE = PLAN_CARDS[2];

function info(over: Partial<PlanInfo> = {}): PlanInfo {
  return {
    plan: null, subscription_status: 'none', current_period_end: null, has_access: true,
    has_subscription: false, access: DEV_PLAN_PRESETS['prueba'](Date.now()), usage: { products: 3, users: 1 },
    channel_change_available_at: null, ...over,
  };
}

describe('planButton (§14 C)', () => {
  it('sin suscripción, todas dicen Elegir y abren el primer pago', () => {
    for (const card of PLAN_CARDS) expect(planButton(card, info())).toEqual({ label: 'Elegir', action: 'checkout', disabled: false });
  });

  it('quien canceló su Starter vuelve con un pago nuevo: Elegir, no "Tu plan"', () => {
    const cancelado = info({ plan: 'starter', has_subscription: false, has_access: false });
    expect(planButton(STARTER, cancelado).action).toBe('checkout');
    expect(isCurrentPlan(STARTER, cancelado)).toBe(false);
  });

  it('con suscripción: su plan dice "Tu plan" y no se toca', () => {
    const starter = info({ plan: 'starter', has_subscription: true, subscription_status: 'active' });
    expect(planButton(STARTER, starter)).toEqual({ label: 'Tu plan', action: 'none', disabled: true });
    expect(isCurrentPlan(STARTER, starter)).toBe(true);
  });

  it('con suscripción, subir y bajar aún no se pueden usar (flujos 15B y 15C)', () => {
    const pro = info({ plan: 'pro', has_subscription: true, subscription_status: 'active' });
    expect(planButton(ENTERPRISE, pro)).toEqual({ label: 'Subir a Enterprise', action: 'upgrade', disabled: true });
    expect(planButton(STARTER, pro)).toEqual({ label: 'Cambiar a Starter', action: 'downgrade', disabled: true });
  });
});

describe('SubscriptionComponent', () => {
  let http: HttpTestingController;
  let queryParams: Record<string, string>;

  function abrir() {
    const fixture = TestBed.createComponent(SubscriptionComponent);
    fixture.detectChanges();
    return fixture;
  }

  const el = (f: { nativeElement: unknown }) => f.nativeElement as HTMLElement;
  const planRequest = () => http.expectOne(`${API}/billing/plan`);

  beforeEach(() => {
    localStorage.clear();
    queryParams = {};
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        // Se arma al crear el componente: cada prueba pone antes sus `queryParams`.
        { provide: ActivatedRoute, useFactory: () => ({ snapshot: { queryParamMap: convertToParamMap(queryParams) } }) },
      ],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('flujo 15A', () => {
    function elegir(nombre: string) {
      const f = abrir();
      planRequest().flush(info());
      f.detectChanges();
      const tarjeta = [...el(f).querySelectorAll('.plan')].find(p => p.querySelector('h2')?.textContent === nombre)!;
      (tarjeta.querySelector('.plan-btn') as HTMLButtonElement).click();
      f.detectChanges();
      const dialog = f.debugElement.query(d => d.componentInstance instanceof CheckoutDialogComponent);
      return { f, dialog: dialog?.componentInstance as CheckoutDialogComponent };
    }

    it('Starter pregunta la mitad y no deja seguir sin elegirla', () => {
      const { f } = elegir('Starter');
      expect(el(f).querySelector('.dialog h2')?.textContent).toBe('¿Qué mitad quieres?');
      expect(el(f).querySelectorAll('.mitad').length).toBe(2);
      const continuar = [...el(f).querySelectorAll('.dialog .primary')].pop() as HTMLButtonElement;
      expect(continuar.disabled).toBe(true);
      expect(el(f).textContent).toContain('Puedes cambiarla una vez al mes');
    });

    it('elige Punto de venta, ve el resumen y paga con esa mitad', () => {
      const { f, dialog } = elegir('Starter');
      const goTo = vi.spyOn(dialog, 'goTo').mockImplementation(() => {});

      (el(f).querySelectorAll('.mitad')[0] as HTMLButtonElement).click();
      f.detectChanges();
      (el(f).querySelector('.dialog .primary') as HTMLButtonElement).click();
      f.detectChanges();

      expect(el(f).querySelector('.resumen')?.textContent).toContain('Starter con Punto de venta');
      expect(el(f).querySelector('.resumen')?.textContent).toContain('$299');

      (el(f).querySelector('.dialog .primary') as HTMLButtonElement).click();
      const req = http.expectOne(`${API}/billing/checkout`);
      expect(req.request.body).toEqual({ plan: 'starter', channel: 'pos' });
      req.flush({ checkout_url: 'https://checkout.stripe.test/s', plan: 'starter' });
      expect(goTo).toHaveBeenCalledWith('https://checkout.stripe.test/s');
    });

    it('Pro se salta la mitad y paga sin channel', () => {
      const { f, dialog } = elegir('Pro');
      vi.spyOn(dialog, 'goTo').mockImplementation(() => {});
      expect(el(f).querySelector('.resumen')?.textContent).toContain('Pro');
      expect(el(f).querySelector('.mitad')).toBeNull();

      (el(f).querySelector('.dialog .primary') as HTMLButtonElement).click();
      expect(http.expectOne(`${API}/billing/checkout`).request.body).toEqual({ plan: 'pro' });
    });

    it('si el pago no se puede iniciar, el modal sigue abierto y avisa', () => {
      const { f } = elegir('Pro');
      const snack = TestBed.inject(SnackbarService);
      (el(f).querySelector('.dialog .primary') as HTMLButtonElement).click();
      http.expectOne(`${API}/billing/checkout`).flush({ success: false, error: 'El cobro no está disponible' }, { status: 503, statusText: 'x' });
      f.detectChanges();
      expect(el(f).querySelector('.dialog')).not.toBeNull();
      expect(snack.messages()[0]?.message).toBe('El cobro no está disponible');
    });

    it('Cancelar cierra el modal sin cobrar', () => {
      const { f } = elegir('Starter');
      (el(f).querySelector('.dialog .ghost') as HTMLButtonElement).click();
      f.detectChanges();
      expect(el(f).querySelector('.dialog')).toBeNull();
      http.expectNone(`${API}/billing/checkout`);
    });

    it('quien vuelve tras cancelar su Starter ve marcada la mitad que tenía', () => {
      const f = abrir();
      planRequest().flush(info({ plan: 'starter', access: DEV_PLAN_PRESETS['cancelado'](Date.now()) }));
      f.detectChanges();
      f.componentInstance.choose(STARTER);
      f.detectChanges();
      expect(el(f).querySelector('.mitad.selected')?.textContent).toContain('Punto de venta');
    });
  });

  describe('al volver de Stripe', () => {
    it('?suscripcion=cancelada: aviso neutro, sin cobro', () => {
      queryParams = { suscripcion: 'cancelada' };
      abrir();
      planRequest().flush(info());
      expect(TestBed.inject(SnackbarService).messages()).toEqual([
        expect.objectContaining({ message: 'No se realizó ningún cobro.', type: 'info' }),
      ]);
    });

    it('?suscripcion=ok: "Activando tu plan…" hasta que llega la suscripción', () => {
      vi.useFakeTimers();
      queryParams = { suscripcion: 'ok' };
      const f = abrir();
      expect(el(f).textContent).toContain('Activando tu plan…');
      vi.advanceTimersByTime(0);

      planRequest().flush(info());                      // el webhook aún no llega
      vi.advanceTimersByTime(2000);
      const activo = info({ plan: 'starter', has_subscription: true, subscription_status: 'active', access: DEV_PLAN_PRESETS['starter-pos'](Date.now()) });
      planRequest().flush(activo);
      f.detectChanges();

      expect(el(f).textContent).not.toContain('Activando tu plan…');
      expect(el(f).querySelector('.plan-actual h2')?.textContent).toBe('Starter');
      expect(TestBed.inject(SnackbarService).messages()[0]?.message).toBe('¡Listo! Tu plan Starter está activo');
      http.expectOne(`${API}/auth/me`);                 // el menú se confirma con el servidor
      vi.advanceTimersByTime(10_000);
      http.expectNone(`${API}/billing/plan`);           // dejó de preguntar
    });

    it('un intento que falla por la red no corta la espera: sigue preguntando', () => {
      vi.useFakeTimers();
      queryParams = { suscripcion: 'ok' };
      const f = abrir();
      vi.advanceTimersByTime(0);
      planRequest().error(new ProgressEvent('error'));
      f.detectChanges();
      expect(el(f).textContent).toContain('Activando tu plan…');
      vi.advanceTimersByTime(2000);
      planRequest().flush(info({ plan: 'pro', has_subscription: true, subscription_status: 'active' }));
      f.detectChanges();
      expect(el(f).textContent).not.toContain('Activando tu plan…');
      http.expectOne(`${API}/auth/me`);
    });

    it('si tras 5 intentos no llega, avisa que se está procesando y deja actualizar', () => {
      vi.useFakeTimers();
      queryParams = { suscripcion: 'ok' };
      const f = abrir();
      vi.advanceTimersByTime(0);
      for (let i = 0; i < 5; i++) {
        planRequest().flush(info());
        vi.advanceTimersByTime(2000);
      }
      http.expectNone(`${API}/billing/plan`);
      f.detectChanges();
      expect(el(f).textContent).toContain('Tu pago se está procesando');

      (el(f).querySelector('.activando-btn') as HTMLButtonElement).click();
      f.detectChanges();
      expect(el(f).textContent).toContain('Activando tu plan…');
      vi.advanceTimersByTime(0);
      planRequest();
    });
  });
});
