/**
 * Prueba del cliente PC-14 — Menú y salida del panel
 *
 * Cada puesto ve en el menú solo lo que le corresponde, entre en el equipo que entre. La
 * opción "Bloquear caja" ya no existe en ninguna vista: salir de una caja registradora es
 * "Cerrar sesión", y la caja queda lista para la siguiente persona.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardLayoutComponent } from './dashboard-layout.component';
import { AuthService } from '../../core/services/auth.service';
import { PERM } from '../../core/permissions';

const EN_UNA_HORA = () => new Date(Date.now() + 3_600_000).toISOString();

const EMPLEADO = [PERM.posSell, PERM.productsRead, PERM.cashView, PERM.devicesUnlock];
const GERENCIA = [...EMPLEADO, PERM.devicesAuthorize, PERM.cashManage, PERM.dashboardView, PERM.salesRead, PERM.teamManage];

function abrir(position: string, permissions: string[], role = 'staff') {
  TestBed.inject(AuthService).profile.set({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    position, position_label: position, full_name: 'Eva Prueba', employee_code: '0004', permissions,
  } as any);
  const fixture = TestBed.createComponent(DashboardLayoutComponent);
  fixture.detectChanges();
  return fixture;
}

const menu = (position: string, permissions: string[], role = 'staff') =>
  abrir(position, permissions, role).componentInstance.visibleNav().map(i => i.label);

describe('PC-14 · Menú y salida del panel', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('un empleado ve sus ventanas: Cobrar, Escanear y Productos, y nada de gestión', () => {
    const items = menu('empleado', EMPLEADO);
    expect(items).toEqual(['Cobrar', 'Escanear', 'Products']);
  });

  it('el empleado ve lo mismo si entra desde una caja autorizada', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 't', name: 'Caja 1', expires_at: EN_UNA_HORA() }));
    expect(menu('empleado', EMPLEADO)).toEqual(['Cobrar', 'Escanear', 'Products']);
  });

  it.each([['dueno', 'business_admin'], ['gerente', 'staff'], ['subgerente', 'staff']])(
    'la gerencia (%s) ve además el panel y la gestión',
    (puesto, rol) => {
      const items = menu(puesto, GERENCIA, rol);
      expect(items).toContain('Dashboard');
      expect(items).toContain('Cobrar');
      expect(items).toContain('Equipo');
    },
  );

  it('no existe la opción de bloquear la caja, ni en un navegador normal ni en una caja autorizada', () => {
    const normal = abrir('empleado', EMPLEADO).nativeElement as HTMLElement;
    expect(normal.textContent).not.toMatch(/bloquear/i);
    expect(normal.querySelector('.lock-btn')).toBeNull();
    TestBed.resetTestingModule();

    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    localStorage.setItem('kard_device', JSON.stringify({ token: 't', name: 'Caja 1', expires_at: EN_UNA_HORA() }));
    const caja = abrir('empleado', EMPLEADO).nativeElement as HTMLElement;
    expect(caja.textContent).not.toMatch(/bloquear/i);
    expect(caja.querySelector('.lock-btn')).toBeNull();
    expect(caja.textContent).toContain('Cerrar sesión');
  });

  it('en una caja autorizada, "Cerrar sesión" deja la caja lista para la siguiente persona', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 't', name: 'Caja 1', expires_at: EN_UNA_HORA() }));
    const fixture = abrir('empleado', EMPLEADO);
    const auth = TestBed.inject(AuthService);
    const lock = vi.spyOn(auth, 'lock').mockImplementation(() => {});
    const logout = vi.spyOn(auth, 'logout').mockImplementation(() => {});

    fixture.componentInstance.logout();

    expect(lock).toHaveBeenCalledTimes(1);
    expect(logout).not.toHaveBeenCalled();
  });

  it('fuera de una caja, "Cerrar sesión" vuelve al inicio de sesión', () => {
    const fixture = abrir('empleado', EMPLEADO);
    const auth = TestBed.inject(AuthService);
    const lock = vi.spyOn(auth, 'lock').mockImplementation(() => {});
    const logout = vi.spyOn(auth, 'logout').mockImplementation(() => {});

    fixture.componentInstance.logout();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(lock).not.toHaveBeenCalled();
  });
});
