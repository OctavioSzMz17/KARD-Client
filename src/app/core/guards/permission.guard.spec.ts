/**
 * Prueba del cliente PC-09 — Permisos en la pantalla
 * (ver docs/Pruebas_IEEE829.md en el repositorio del backend)
 *
 * La pantalla muestra u oculta según los permisos que manda el servidor. NO es
 * la protección (el servidor rechaza cada operación que el puesto no permite),
 * pero tiene que ser fiel: un empleado no debe ver el menú de un gerente, ni
 * caer en una pantalla en blanco al pedir una que no le toca.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

import { AuthService } from '../services/auth.service';
import { PERM, fallbackPermissions, levelOf, positionLabel } from '../permissions';
import { permissionGuard } from './auth.guard';

const TOKEN_KEY = 'kard_token';
const USER_KEY = 'kard_user';

const EMPLEADO = ['cash:view', 'devices:unlock', 'pos:sell', 'products:read'];
const SUPERVISOR = [...EMPLEADO, 'devices:authorize', 'products:write', 'inventory:adjust', 'cash:manage', 'sales:read', 'sales:manage', 'team:manage', 'dashboard:view'];

function sesion(role: string, permissions?: string[], position?: string): void {
  localStorage.setItem(TOKEN_KEY, 'token');
  localStorage.setItem(USER_KEY, JSON.stringify({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role, business_type: 'restaurant',
    ...(permissions ? { permissions } : {}),
    ...(position ? { position } : {}),
  }));
}

function correr(permission: Parameters<typeof permissionGuard>[0]): boolean | UrlTree {
  return TestBed.runInInjectionContext(() => permissionGuard(permission)({} as any, {} as any)) as boolean | UrlTree;
}

describe('PC-09 · Permisos en la pantalla', () => {
  let router: Router;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    router = TestBed.inject(Router);
  });

  afterEach(() => localStorage.clear());

  const destino = (r: boolean | UrlTree) => (r instanceof UrlTree ? router.serializeUrl(r) : r);

  describe('AuthService.can', () => {
    it('usa los permisos que mandó el servidor', () => {
      sesion('staff', EMPLEADO, 'empleado');
      const auth = TestBed.inject(AuthService);
      expect(auth.can(PERM.posSell)).toBe(true);
      expect(auth.can(PERM.productsRead)).toBe(true);
      expect(auth.can(PERM.productsWrite)).toBe(false);
      expect(auth.can(PERM.teamManage)).toBe(false);
    });

    it('sin sesión no puede nada', () => {
      const auth = TestBed.inject(AuthService);
      for (const p of Object.values(PERM)) expect(auth.can(p)).toBe(false);
    });

    it('una sesión de cliente tampoco puede nada del panel', () => {
      localStorage.setItem(TOKEN_KEY, 'token');
      localStorage.setItem(USER_KEY, JSON.stringify({ kind: 'consumer', consumer_id: 'c_1' }));
      const auth = TestBed.inject(AuthService);
      expect(auth.can(PERM.posSell)).toBe(false);
    });

    it('una sesión vieja de dueño (sin lista de permisos) conserva todo', () => {
      sesion('business_admin');
      const auth = TestBed.inject(AuthService);
      for (const p of Object.values(PERM)) expect(auth.can(p)).toBe(true);
    });

    it('una sesión vieja de personal (sin lista) queda con lo básico, nunca con más', () => {
      sesion('staff');
      const auth = TestBed.inject(AuthService);
      expect(auth.can(PERM.posSell)).toBe(true);
      expect(auth.can(PERM.productsWrite)).toBe(false);
      expect(auth.can(PERM.billingManage)).toBe(false);
    });

    it('una lista de permisos vacía no cae al respaldo: no puede nada', () => {
      sesion('business_admin', []);
      const auth = TestBed.inject(AuthService);
      expect(auth.can(PERM.posSell)).toBe(false);
    });

    it('si cambia el perfil, la señal lo refleja sin recargar', () => {
      sesion('staff', EMPLEADO, 'empleado');
      const auth = TestBed.inject(AuthService);
      expect(auth.can(PERM.inventoryAdjust)).toBe(false);

      auth.profile.set({ ...auth.profile()!, permissions: [...EMPLEADO, 'inventory:adjust'] });
      expect(auth.can(PERM.inventoryAdjust)).toBe(true);
    });
  });

  describe('permissionGuard', () => {
    it('deja pasar a quien tiene el permiso', () => {
      sesion('staff', SUPERVISOR, 'gerente');
      expect(correr(PERM.productsWrite)).toBe(true);
    });

    it('manda a un empleado a Cobrar cuando pide una pantalla de gestión', () => {
      sesion('staff', EMPLEADO, 'empleado');
      expect(destino(correr(PERM.teamManage))).toBe('/dashboard/cobrar');
      expect(destino(correr(PERM.cashManage))).toBe('/dashboard/cobrar');
      expect(destino(correr(PERM.billingManage))).toBe('/dashboard/cobrar');
    });

    it('un empleado sí entra a Cobrar y a Productos', () => {
      sesion('staff', EMPLEADO, 'empleado');
      expect(correr(PERM.posSell)).toBe(true);
      expect(correr(PERM.productsRead)).toBe(true);
    });

    it('el panel de inicio es de quien supervisa: un empleado cae en Cobrar', () => {
      sesion('staff', EMPLEADO, 'empleado');
      expect(destino(correr(PERM.dashboardView))).toBe('/dashboard/cobrar');
    });

    it('un supervisor pide la suscripción y vuelve al panel de inicio, no a Cobrar', () => {
      sesion('staff', SUPERVISOR, 'gerente');
      expect(destino(correr(PERM.billingManage))).toBe('/dashboard');
    });

    it('sin sesión, al login', () => {
      expect(destino(correr(PERM.posSell))).toBe('/login');
    });

    it('no se queda en un ciclo: la pantalla a la que redirige siempre es accesible', () => {
      for (const permisos of [EMPLEADO, SUPERVISOR]) {
        localStorage.clear();
        sesion('staff', permisos);
        const auth = TestBed.inject(AuthService);
        auth.profile.set(JSON.parse(localStorage.getItem(USER_KEY)!));
        const home = auth.homeRoute();
        const pedido = home === '/dashboard' ? PERM.dashboardView : home === '/dashboard/cobrar' ? PERM.posSell : PERM.productsRead;
        expect(correr(pedido)).toBe(true);
      }
    });
  });

  describe('permissions.ts', () => {
    it('el respaldo de personal es exactamente lo del empleado', () => {
      expect([...fallbackPermissions('staff')].sort()).toEqual(EMPLEADO);
    });

    it('el nivel va de más a menos autoridad', () => {
      expect(levelOf('dueno')).toBe(0);
      expect(levelOf('gerente')).toBeLessThan(levelOf('subgerente'));
      expect(levelOf('subgerente')).toBeLessThan(levelOf('encargado_area'));
      expect(levelOf('encargado_area')).toBeLessThan(levelOf('empleado'));
    });

    it('un puesto desconocido cuenta como el más bajo', () => {
      expect(levelOf('director_general')).toBe(levelOf('empleado'));
    });

    it('los puestos se muestran en español', () => {
      expect(positionLabel('encargado_area')).toBe('Encargado de área');
      expect(positionLabel('dueno')).toBe('Dueño');
      expect(positionLabel(undefined)).toBe('');
    });
  });
});
