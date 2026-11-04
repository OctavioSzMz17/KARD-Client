/**
 * Prueba del cliente PC-13 — Entrar a Cobrar sin esperar autorización
 *
 * Quien inicia sesión con el login normal (un empleado en su celular o en cualquier
 * computadora) entra a su panel y cobra sin que nadie autorice su equipo. El equipo
 * autorizado solo existe para la pantalla de la caja registradora (/caja-registradora).
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PosComponent } from './pos.component';
import { AuthService } from '../../core/services/auth.service';
import { routes } from '../../app.routes';
import { PERM } from '../../core/permissions';

function sesion(position: string, role = 'staff') {
  return {
    kind: 'b2b' as const, user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    position, position_label: position, full_name: 'Eva Prueba', employee_code: '0004',
    permissions: [PERM.posSell, PERM.productsRead, PERM.devicesUnlock],
  };
}

describe('PC-13 · Entrar a Cobrar sin esperar autorización', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  function abrir(position: string, role?: string) {
    TestBed.inject(AuthService).profile.set(sesion(position, role) as any);
    const fixture = TestBed.createComponent(PosComponent);
    fixture.detectChanges();
    return { fixture, pos: fixture.componentInstance };
  }

  it.each([['empleado', 'staff'], ['encargado_area', 'staff'], ['subgerente', 'staff'], ['gerente', 'staff'], ['dueno', 'business_admin']])(
    '%s entra a Cobrar: nadie lo manda a autorizar el equipo',
    (puesto, rol) => {
      abrir(puesto, rol);
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(router.navigate).not.toHaveBeenCalled();
    },
  );

  it.each([['empleado', 'staff'], ['encargado_area', 'staff'], ['gerente', 'staff']])(
    '%s no ve ningún aviso de equipo no autorizado',
    (puesto, rol) => {
      const { fixture, pos } = abrir(puesto, rol);
      expect(pos.blocker() ?? '').not.toMatch(/autoriza/i);
      expect((fixture.nativeElement as HTMLElement).textContent).not.toMatch(/equipo no es una caja/i);
    },
  );

  it('la ruta de Cobrar solo exige el permiso, no un equipo autorizado', () => {
    const dashboard = routes.find(r => r.path === 'dashboard')!;
    const cobrar = dashboard.children!.find(r => r.path === 'cobrar')!;
    expect(cobrar.canActivate).toHaveLength(1);
  });
});
