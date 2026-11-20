/**
 * Planes en la pantalla: qué mitad pide cada pantalla, a dónde va quien no
 * puede entrar y los estados de ejemplo para desarrollo
 * (ver docs/Planes_contrato_frontend.md en el repositorio del backend).
 */
import { describe, expect, it } from 'vitest';
import { DEV_PLAN_PRESETS, hasChannel, homeRouteFor, parsePlanOverride } from './plan-logic';
import { PERM, Permission } from './permissions';

const NOW = Date.parse('2026-11-19T12:00:00Z');

describe('hasChannel', () => {
  it('lee la mitad del plan', () => {
    const pos = DEV_PLAN_PRESETS['starter-pos'](NOW);
    expect(hasChannel(pos, 'pos')).toBe(true);
    expect(hasChannel(pos, 'store')).toBe(false);
  });

  it('sin plan conocido no esconde nada (el servidor decide)', () => {
    expect(hasChannel(null, 'pos')).toBe(true);
    expect(hasChannel(null, 'store')).toBe(true);
  });
});

describe('homeRouteFor', () => {
  const EMPLEADO: Permission[] = [PERM.posSell, PERM.productsRead, PERM.cashView, PERM.devicesUnlock];
  const can = (perms: Permission[]) => (p: Permission) => perms.includes(p);

  it('un empleado con POS cae en Cobrar', () => {
    expect(homeRouteFor(can(EMPLEADO), () => true)).toBe('/dashboard/cobrar');
  });

  it('un empleado sin la mitad de POS no cae en Cobrar ni en Escanear: va a Productos', () => {
    expect(homeRouteFor(can(EMPLEADO), c => c === 'store')).toBe('/dashboard/products');
  });

  it('quien supervisa va al inicio, tenga la mitad que tenga', () => {
    expect(homeRouteFor(can([...EMPLEADO, PERM.dashboardView]), () => false)).toBe('/dashboard');
  });

  it('sin permisos, al login', () => {
    expect(homeRouteFor(() => false, () => true)).toBe('/login');
  });
});

describe('estados de ejemplo (solo desarrollo)', () => {
  it('Starter de POS: solo POS, topes de 50 y 2, sin envíos ni descarga', () => {
    const a = parsePlanOverride('starter-pos', NOW)!;
    expect(a).toMatchObject({
      state: 'active', plan: 'starter', channel: 'pos', pos: true, store: false, store_public: false,
      max_products: 50, max_users: 2, delivery: false, sales_export: false, read_only: false,
    });
  });

  it('Starter de tienda: la tienda se ve y el POS no', () => {
    expect(parsePlanOverride('starter-tienda', NOW)).toMatchObject({ store: true, store_public: true, pos: false });
  });

  it('la prueba trae todo y cuenta los días', () => {
    const a = parsePlanOverride('prueba-por-vencer', NOW)!;
    expect(a).toMatchObject({ state: 'trial', plan: null, store: true, pos: true, trial_days_left: 5 });
    expect(Date.parse(a.trial_ends_at!)).toBe(NOW + 5 * 86_400_000);
  });

  it('vencido: solo lectura y la tienda apagada, sin plan', () => {
    expect(parsePlanOverride('vencido', NOW)).toMatchObject({
      state: 'expired', plan: null, read_only: true, store_public: false, store: true, pos: true,
    });
  });

  it('cancelado: conserva lo de su último plan, en solo lectura', () => {
    expect(parsePlanOverride('cancelado', NOW)).toMatchObject({ state: 'expired', plan: 'starter', pos: true, store: false, read_only: true });
  });

  it('un JSON cambia campos sobre la prueba', () => {
    expect(parsePlanOverride('{"read_only": true, "pos": false}', NOW)).toMatchObject({ state: 'trial', read_only: true, pos: false, store: true });
  });

  it('algo ilegible o vacío se ignora', () => {
    expect(parsePlanOverride(null)).toBeNull();
    expect(parsePlanOverride('')).toBeNull();
    expect(parsePlanOverride('no-existe')).toBeNull();
    expect(parsePlanOverride('42')).toBeNull();
  });
});
