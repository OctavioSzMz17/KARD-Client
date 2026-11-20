/**
 * Funciones sueltas de Pro (flujo 15F de docs/Planes_contrato_frontend.md):
 * el envío a domicilio en los ajustes de entrega y el botón de descargar el
 * reporte de ventas. Con candado y la etiqueta "Pro"; la etiqueta abre el
 * modal de mejora. La descarga la bloquea SOLO la pantalla (el backend no).
 */
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { environment } from '../../environments/environment';
import { DEV_PLAN_PRESETS } from '../core/plan-logic';
import { AuthService } from '../core/services/auth.service';
import { Fulfillment } from '../core/services/fulfillment.service';
import { UpgradeService } from '../core/services/upgrade.service';
import { PERM } from '../core/permissions';
import { HomeComponent } from './home/home.component';
import { SalesComponent } from './sales/sales.component';

const API = environment.apiUrl;
const FULFILLMENT = `${API}/settings/fulfillment`;

const GUARDADO: Fulfillment = {
  dine_in: true, takeaway: true, pickup: false, delivery: true,
  shipping_flat_fee: 40, free_shipping_above: 500, delivery_notes: 'Solo en el centro',
} as Fulfillment;

function sesion(plan: string, owner = true): void {
  TestBed.inject(AuthService).profile.set({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: owner ? 'business_admin' : 'staff', business_type: 'restaurant',
    permissions: owner ? Object.values(PERM) : [PERM.salesRead, PERM.dashboardView],
    plan: DEV_PLAN_PRESETS[plan](Date.now()),
  });
}

let http: HttpTestingController;

beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('15F · envío a domicilio', () => {
  function ajustes(plan: string, owner = true) {
    sesion(plan, owner);
    const f = TestBed.createComponent(HomeComponent);
    f.detectChanges();
    f.componentInstance.openSettings();
    http.expectOne(r => r.url === FULFILLMENT && r.method === 'GET').flush(GUARDADO);
    f.detectChanges();
    return { f, el: f.nativeElement as HTMLElement };
  }

  it('en Starter el envío sale con candado, "Pro" y el texto de la guía; no se puede encender', () => {
    const { el } = ajustes('starter-pos');
    const envio = el.querySelector('.modo-locked')!;
    expect(envio.textContent).toContain('Envío a domicilio');
    expect(envio.textContent).toContain('Ofrece envíos con el plan Pro.');
    expect(envio.querySelector('.pro-tag')?.textContent?.trim()).toBe('Pro');
    expect(el.querySelector('.envio-box')).toBeNull();          // sin tarifa de envío que capturar
  });

  it('la etiqueta Pro abre el modal de mejora (dueño)', () => {
    const { el } = ajustes('starter-pos');
    (el.querySelector('.modo-locked button.pro-tag') as HTMLButtonElement).click();
    expect(TestBed.inject(UpgradeService).target()).toBe('pro');
  });

  it('al equipo la etiqueta solo informa', () => {
    const { el } = ajustes('starter-pos', false);
    expect(el.querySelector('.modo-locked button.pro-tag')).toBeNull();
    expect(el.querySelector('.modo-locked span.pro-tag')).not.toBeNull();
  });

  it('guardar en Starter manda el envío apagado (encendido respondería 402 y no dejaría guardar)', () => {
    const { f } = ajustes('starter-pos');
    f.componentInstance.saveSettings();
    const req = http.expectOne(r => r.url === FULFILLMENT && r.method === 'PUT');
    expect(req.request.body).toMatchObject({ delivery: false, shipping_flat_fee: 0, free_shipping_above: null, dine_in: true });
  });

  it('en Pro el envío es un modo normal y guarda lo que tenía', () => {
    const { f, el } = ajustes('pro');
    expect(el.querySelector('.modo-locked')).toBeNull();
    expect(el.querySelector('.envio-box')).not.toBeNull();
    f.componentInstance.saveSettings();
    expect(http.expectOne(r => r.url === FULFILLMENT && r.method === 'PUT').request.body).toMatchObject({ delivery: true, shipping_flat_fee: 40 });
  });
});

describe('15F · descargar el reporte de ventas', () => {
  function ventas(plan: string, owner = true) {
    sesion(plan, owner);
    const f = TestBed.createComponent(SalesComponent);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const botones = () => [...el.querySelectorAll('.export-actions .btn')] as HTMLButtonElement[];
    return { f, el, botones };
  }

  it('en Starter CSV y PDF quedan deshabilitados con "Disponible en el plan Pro"', () => {
    const { el, botones } = ventas('starter-pos');
    for (const b of botones()) {
      expect(b.disabled).toBe(true);
      expect(b.title).toBe('Disponible en el plan Pro');
    }
    expect(el.querySelector('.export-actions .pro-tag')?.textContent).toContain('Pro');
  });

  it('aunque alguien llame a descargar, no se arma el archivo', async () => {
    const { f } = ventas('starter-pos');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    await f.componentInstance.downloadCsv();
    await f.componentInstance.downloadPdf();
    expect(open).not.toHaveBeenCalled();
    http.expectNone(r => r.url.includes('/export'));
  });

  it('la etiqueta Pro abre el modal de mejora', () => {
    const { el } = ventas('starter-tienda');
    (el.querySelector('.export-actions button.pro-tag') as HTMLButtonElement).click();
    expect(TestBed.inject(UpgradeService).target()).toBe('pro');
  });

  it('en Pro se descarga como siempre', () => {
    const { el, botones } = ventas('pro');
    expect(el.querySelector('.pro-tag')).toBeNull();
    expect(botones().every(b => !b.hasAttribute('title'))).toBe(true);
  });

  it('en solo lectura se puede descargar si su último plan lo incluía (§13)', () => {
    const { el } = ventas('vencido');           // nunca pagó: la prueba incluía todo
    expect(el.querySelector('.pro-tag')).toBeNull();
  });
});
