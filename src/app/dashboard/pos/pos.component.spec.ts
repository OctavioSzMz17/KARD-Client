/**
 * Prueba del cliente PC-13 — Entrar a Cobrar sin ser una caja autorizada
 *
 * Quien inicia sesión con el login normal (un empleado en su celular o en una
 * computadora cualquiera) debe ENTRAR a la pantalla de cobro sin que lo desvíen a
 * autorizar el equipo. Esa pantalla (/caja-registradora) es solo del "Modo caja".
 * Lo que sí cambia es que no puede cobrar desde ahí, y se le avisa por qué.
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

const EN_UNA_HORA = () => new Date(Date.now() + 3_600_000).toISOString();

const AVISO = 'Este equipo no es una caja autorizada';

function sesion(position: string, role = 'staff') {
  return {
    kind: 'b2b' as const, user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    position, position_label: position, full_name: 'Eva Prueba', employee_code: '0004',
    permissions: [PERM.posSell, PERM.productsRead, PERM.devicesUnlock],
  };
}

describe('PC-13 · Entrar a Cobrar sin ser una caja autorizada', () => {
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

  it('un empleado con el login normal entra a la pantalla: nadie lo manda a /caja-registradora', () => {
    abrir('empleado');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('y se le avisa por qué no puede cobrar desde ahí', () => {
    const { fixture, pos } = abrir('empleado');
    expect(pos.blocker()).toContain(AVISO);
    expect((fixture.nativeElement as HTMLElement).textContent).toContain(AVISO);
  });

  it('el botón de cobrar queda deshabilitado', () => {
    const { fixture } = abrir('empleado');
    const boton = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.charge-btn')!;
    expect(boton.disabled).toBe(true);
  });

  it('lo mismo para un encargado de área', () => {
    expect(abrir('encargado_area').pos.blocker()).toContain(AVISO);
  });

  it('en una caja autorizada el aviso desaparece', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 'tok', name: 'Caja 1', expires_at: EN_UNA_HORA() }));
    expect(abrir('empleado').pos.blocker() ?? '').not.toContain(AVISO);
  });

  it('un equipo autorizado que ya venció tampoco cuenta como caja', () => {
    localStorage.setItem('kard_device', JSON.stringify({ token: 'tok', name: 'Caja 1', expires_at: new Date(Date.now() - 1000).toISOString() }));
    expect(abrir('empleado').pos.blocker()).toContain(AVISO);
  });

  it.each([['dueno', 'business_admin'], ['gerente', 'staff'], ['subgerente', 'staff']])(
    'la gerencia (%s) cobra desde cualquier lugar: no ve el aviso',
    (puesto, rol) => {
      expect(abrir(puesto, rol).pos.blocker() ?? '').not.toContain(AVISO);
    },
  );

  it('la ruta de Cobrar solo exige el permiso, no un equipo autorizado', () => {
    const dashboard = routes.find(r => r.path === 'dashboard')!;
    const cobrar = dashboard.children!.find(r => r.path === 'cobrar')!;
    expect(cobrar.canActivate).toHaveLength(1);
  });
});
