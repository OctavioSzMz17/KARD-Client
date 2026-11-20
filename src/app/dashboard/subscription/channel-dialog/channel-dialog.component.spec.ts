/**
 * Flujo 15D, cambiar la mitad de Starter (docs/Planes_contrato_frontend.md):
 * confirmar antes, y si aún no han pasado 30 días, decir desde cuándo.
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../../../environments/environment';
import { PlanInfo } from '../../../core/models/plan.models';
import { DEV_PLAN_PRESETS } from '../../../core/plan-logic';
import { planErrorInterceptor } from '../../../core/interceptors/plan-error.interceptor';
import { PlanNoticeService } from '../../../core/services/plan-notice.service';
import { channelSwitchCopy } from '../subscription-logic';
import { ChannelDialogComponent } from './channel-dialog.component';

const API = environment.apiUrl;

describe('channelSwitchCopy', () => {
  it('a la tienda: el punto de venta deja de estar disponible, las ventas no se borran', () => {
    expect(channelSwitchCopy('store')).toEqual({
      title: '¿Cambiar a tienda en línea?',
      body: 'Tu punto de venta dejará de estar disponible; tus ventas y cortes no se borran.',
      action: 'Cambiar a tienda en línea',
    });
  });

  it('al punto de venta: la tienda deja de verse', () => {
    expect(channelSwitchCopy('pos').body).toContain('Tu tienda en línea dejará de verse');
  });
});

describe('ChannelDialogComponent', () => {
  let http: HttpTestingController;

  function abrir() {
    const fixture = TestBed.createComponent(ChannelDialogComponent);
    fixture.componentRef.setInput('target', 'store');
    const out = { closed: vi.fn(), changed: vi.fn(), reload: vi.fn() };
    fixture.componentInstance.closed.subscribe(out.closed);
    fixture.componentInstance.changed.subscribe(out.changed);
    fixture.componentInstance.reload.subscribe(out.reload);
    fixture.detectChanges();
    return { f: fixture, el: fixture.nativeElement as HTMLElement, ...out };
  }

  const confirmar = (el: HTMLElement) => el.querySelector('.neutral') as HTMLButtonElement;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kard_token', 'token');
    localStorage.setItem('kard_user', JSON.stringify({
      kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'business_admin', business_type: 'restaurant', permissions: ['billing:manage'],
    }));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([planErrorInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => localStorage.clear());

  it('explica qué deja y que solo se puede una vez cada 30 días, sin cobrar de nuevo', () => {
    const { el } = abrir();
    expect(el.querySelector('h2')?.textContent).toBe('¿Cambiar a tienda en línea?');
    expect(el.textContent).toContain('tus ventas y cortes no se borran');
    expect(el.textContent).toContain('Solo puedes cambiar una vez cada 30 días');
    expect(el.querySelector('.primary')).toBeNull();     // confirmar va en color neutro
  });

  it('al confirmar manda la mitad y entrega el estado nuevo', () => {
    const { f, el, changed, closed } = abrir();
    confirmar(el).click();
    const req = http.expectOne(`${API}/billing/channel`);
    expect(req.request.body).toEqual({ channel: 'store' });
    const nuevo = { plan: 'starter', has_subscription: true, access: DEV_PLAN_PRESETS['starter-tienda'](Date.now()) } as PlanInfo;
    req.flush(nuevo);
    f.detectChanges();
    expect(changed).toHaveBeenCalledWith(nuevo);
    expect(closed).toHaveBeenCalled();
  });

  it('si aún no puede (409 channel_cooldown): aviso con la fecha, se cierra y pide recargar', () => {
    const { el, changed, closed, reload } = abrir();
    confirmar(el).click();
    http.expectOne(`${API}/billing/channel`).flush(
      { success: false, error: 'Solo puedes cambiar de mitad una vez cada 30 días.', code: 'channel_cooldown', available_at: '2026-12-12T18:00:00+00:00' },
      { status: 409, statusText: 'Conflict' },
    );
    expect(TestBed.inject(PlanNoticeService).current()?.title).toBe('Podrás cambiar el 12 de diciembre');
    expect(changed).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
    expect(closed).toHaveBeenCalled();
  });

  it('otro error se queda en el modal', () => {
    const { f, el, closed } = abrir();
    confirmar(el).click();
    http.expectOne(`${API}/billing/channel`).flush({ success: false, error: 'Stripe no respondió' }, { status: 503, statusText: 'x' });
    f.detectChanges();
    expect(el.querySelector('.error')?.textContent).toContain('Stripe no respondió');
    expect(closed).not.toHaveBeenCalled();
  });
});
