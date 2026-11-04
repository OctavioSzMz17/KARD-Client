/**
 * Prueba del cliente PC-14 — Menú del panel según dónde se entró
 *
 * Un empleado que entra con el login normal (en su celular, por ejemplo) no puede cobrar
 * desde ahí, así que "Cobrar" no se le ofrece: ve su sección Escanear, Productos y lo demás.
 * Cobrar aparece cuando el navegador es una caja autorizada. La gerencia lo ve siempre.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DashboardLayoutComponent } from './dashboard-layout.component';
import { AuthService } from '../../core/services/auth.service';
import { PERM } from '../../core/permissions';

const EN_UNA_HORA = () => new Date(Date.now() + 3_600_000).toISOString();

const EMPLEADO = [PERM.posSell, PERM.productsRead, PERM.cashView, PERM.devicesUnlock];
const GERENCIA = [...EMPLEADO, PERM.devicesAuthorize, PERM.cashManage, PERM.dashboardView, PERM.salesRead, PERM.teamManage];

function menu(position: string, permissions: string[], role = 'staff'): string[] {
  TestBed.inject(AuthService).profile.set({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    position, position_label: position, full_name: 'Eva Prueba', employee_code: '0004', permissions,
  } as any);
  const fixture = TestBed.createComponent(DashboardLayoutComponent);
  return fixture.componentInstance.visibleNav().map(i => i.label);
}

describe('PC-14 · Menú del panel según dónde se entró', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
  });

  afterEach(() => localStorage.clear());

  it('un empleado en su celular ve Escanear y Productos, pero no Cobrar', () => {
    const items = menu('empleado', EMPLEADO);
    expect(items).toContain('Escanear');
    expect(items).toContain('Products');
    expect(items).not.toContain('Cobrar');
  });

  it('en una caja autorizada, el empleado sí ve Cobrar', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 't', name: 'Caja 1', expires_at: EN_UNA_HORA() }));
    expect(menu('empleado', EMPLEADO)).toContain('Cobrar');
  });

  it('un equipo autorizado vencido no cuenta como caja', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 't', name: 'Caja 1', expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(menu('empleado', EMPLEADO)).not.toContain('Cobrar');
  });

  it('un encargado de área tampoco ve Cobrar fuera de una caja', () => {
    expect(menu('encargado_area', EMPLEADO)).not.toContain('Cobrar');
  });

  it.each([['dueno', 'business_admin'], ['gerente', 'staff'], ['subgerente', 'staff']])(
    'la gerencia (%s) ve Cobrar desde cualquier equipo',
    (puesto, rol) => {
      expect(menu(puesto, GERENCIA, rol)).toContain('Cobrar');
    },
  );
});
