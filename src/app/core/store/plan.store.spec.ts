/**
 * El plan del negocio en la pantalla: sale de /auth/me (todo el equipo lo
 * recibe), se guarda junto a los permisos y se puede refrescar tras pagar.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClient, HttpContext, HttpErrorResponse, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { environment } from '../../../environments/environment';
import { PLAN_DEV_OVERRIDE, PlanStore } from './plan.store';
import { AuthService } from '../services/auth.service';
import { PlanNoticeService } from '../services/plan-notice.service';
import { SnackbarService } from '../services/snackbar.service';
import { SKIP_PLAN_NOTICE, planErrorInterceptor } from '../interceptors/plan-error.interceptor';
import { DEV_PLAN_PRESETS, PLAN_OVERRIDE_KEY } from '../plan-logic';
import { PlanAccess } from '../models/plan.models';

const USER_KEY = 'kard_user';
const API = environment.apiUrl;
const STARTER_POS = DEV_PLAN_PRESETS['starter-pos'](Date.now());
const PRO = DEV_PLAN_PRESETS['pro'](Date.now());

function sesion(permissions: string[], plan?: PlanAccess | null): void {
  localStorage.setItem('kard_token', 'token');
  localStorage.setItem(USER_KEY, JSON.stringify({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: 'staff', business_type: 'restaurant',
    permissions, ...(plan !== undefined ? { plan } : {}),
  }));
}

function configurar(devOverride = false): void {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(withInterceptors([planErrorInterceptor])),
      provideHttpClientTesting(),
      provideRouter([]),
      { provide: PLAN_DEV_OVERRIDE, useValue: devOverride },
    ],
  });
}

const ME = (plan: PlanAccess | null) => ({
  user_id: 'u_1', tenant_id: 't_1', business_type: 'restaurant', role: 'staff', email: 'a@b.mx',
  position: 'empleado', position_label: 'Empleado', full_name: null, employee_code: '0002',
  permissions: ['pos:sell'], plan,
});

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('PlanStore', () => {
  it('lee el plan guardado en la sesión y expone sus banderas', () => {
    sesion(['pos:sell'], STARTER_POS);
    configurar();
    const plan = TestBed.inject(PlanStore);
    expect(plan.hasPos()).toBe(true);
    expect(plan.hasStore()).toBe(false);
    expect(plan.readOnly()).toBe(false);
    expect(plan.maxProducts()).toBe(50);
    expect(plan.canUse('pos:sell', 'pos')).toBe(true);
    expect(plan.canUse('pos:sell', 'store')).toBe(false);
  });

  it('sin plan conocido todavía, no esconde nada', () => {
    sesion(['pos:sell']);
    configurar();
    const plan = TestBed.inject(PlanStore);
    expect(plan.access()).toBeNull();
    expect(plan.hasPos()).toBe(true);
    expect(plan.hasStore()).toBe(true);
    expect(plan.readOnly()).toBe(false);
    expect(plan.trialDaysLeft()).toBeNull();
  });

  it('refresh() pide /auth/me y guarda el plan junto a los permisos', () => {
    sesion(['pos:sell']);
    configurar();
    const plan = TestBed.inject(PlanStore);
    const http = TestBed.inject(HttpTestingController);

    let recibido: PlanAccess | null | undefined;
    plan.refresh().subscribe(a => (recibido = a));
    http.expectOne(`${API}/auth/me`).flush(ME(STARTER_POS));

    expect(recibido).toEqual(STARTER_POS);
    expect(plan.hasStore()).toBe(false);
    const guardado = JSON.parse(localStorage.getItem(USER_KEY)!);
    expect(guardado.plan).toEqual(STARTER_POS);
    expect(guardado.permissions).toEqual(['pos:sell']);
  });

  it('apply() cambia el plan al instante (p. ej. con el access de change-plan)', () => {
    sesion(['pos:sell'], STARTER_POS);
    configurar();
    const plan = TestBed.inject(PlanStore);
    plan.apply(PRO);
    expect(plan.hasStore()).toBe(true);
    expect(JSON.parse(localStorage.getItem(USER_KEY)!).plan).toEqual(PRO);
  });

  describe('sobrescribir en desarrollo', () => {
    it('lee el estado de ejemplo de localStorage', () => {
      sesion(['pos:sell'], PRO);
      localStorage.setItem(PLAN_OVERRIDE_KEY, 'vencido');
      configurar(true);
      const plan = TestBed.inject(PlanStore);
      expect(plan.overridden()).toBe(true);
      expect(plan.readOnly()).toBe(true);
      expect(plan.storePublic()).toBe(false);
    });

    it('setOverride lo cambia y null vuelve al plan real', () => {
      sesion(['pos:sell'], PRO);
      configurar(true);
      const plan = TestBed.inject(PlanStore);
      plan.setOverride('starter-tienda');
      expect(plan.hasPos()).toBe(false);
      expect(localStorage.getItem(PLAN_OVERRIDE_KEY)).toBe('starter-tienda');

      plan.setOverride(null);
      expect(plan.hasPos()).toBe(true);
      expect(localStorage.getItem(PLAN_OVERRIDE_KEY)).toBeNull();
    });

    it('en producción no se lee ni se puede cambiar', () => {
      sesion(['pos:sell'], PRO);
      localStorage.setItem(PLAN_OVERRIDE_KEY, 'vencido');
      configurar(false);
      const plan = TestBed.inject(PlanStore);
      expect(plan.readOnly()).toBe(false);
      plan.setOverride('starter-tienda');
      expect(plan.hasStore()).toBe(true);
    });
  });
});

describe('planErrorInterceptor', () => {
  function pedir(context?: HttpContext) {
    const client = TestBed.inject(HttpClient);
    let error: unknown;
    client.post(`${API}/products`, {}, { context }).subscribe({ error: e => (error = e) });
    return { http: TestBed.inject(HttpTestingController), error: () => error };
  }

  it('un 402 del plan abre su aviso, vuelve a pedir el plan y deja seguir el error a quien llamó', () => {
    sesion(['products:write', 'billing:manage'], STARTER_POS);
    configurar();
    const { http, error } = pedir();
    http.expectOne(`${API}/products`).flush(
      { success: false, error: 'Tu plan permite hasta 50 productos.', code: 'limit_reached', limit: 'products', max: 50 },
      { status: 402, statusText: 'Payment Required' },
    );

    expect(TestBed.inject(PlanNoticeService).current()?.title).toBe('Llegaste a 50 productos');
    expect((error() as HttpErrorResponse).status).toBe(402);
    http.expectOne(`${API}/auth/me`);
  });

  it('mientras el aviso está abierto no se apila el toast de error que diría lo mismo', () => {
    sesion(['products:write', 'billing:manage'], STARTER_POS);
    configurar();
    const snack = TestBed.inject(SnackbarService);
    const { http } = pedir();
    http.expectOne(`${API}/products`).flush(
      { success: false, error: 'x', code: 'read_only' }, { status: 402, statusText: 'Payment Required' },
    );
    snack.error('x');
    expect(snack.messages()).toEqual([]);

    TestBed.inject(PlanNoticeService).close();
    snack.error('otro error');
    expect(snack.messages().length).toBe(1);
  });

  it('no toca el 409 de falta de stock', () => {
    sesion(['pos:sell']);
    configurar();
    const { http, error } = pedir();
    http.expectOne(`${API}/products`).flush(
      { success: false, error: 'Sin stock', code: 'INSUFFICIENT_STOCK' }, { status: 409, statusText: 'Conflict' },
    );
    expect(TestBed.inject(PlanNoticeService).current()).toBeNull();
    expect((error() as HttpErrorResponse).status).toBe(409);
    http.expectNone(`${API}/auth/me`);
  });

  it('una pantalla puede pedir que no abra el aviso', () => {
    sesion(['billing:manage']);
    configurar();
    const { http } = pedir(new HttpContext().set(SKIP_PLAN_NOTICE, true));
    http.expectOne(`${API}/products`).flush(
      { success: false, error: 'x', code: 'read_only' }, { status: 402, statusText: 'Payment Required' },
    );
    expect(TestBed.inject(PlanNoticeService).current()).toBeNull();
  });
});
