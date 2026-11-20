/**
 * Lógica pura de los planes en la pantalla, sin Angular: qué mitad pide cada
 * pantalla, a dónde mandar a quien no puede entrar y los estados de ejemplo
 * para desarrollo.
 *
 * No calcula reglas de negocio: esas llegan resueltas del servidor en
 * `PlanAccess`. Aquí solo se LEEN esas banderas.
 */
import { Channel, PlanAccess } from './models/plan.models';
import { PERM, Permission } from './permissions';

/**
 * ¿El plan incluye esta mitad? Sin plan conocido (sesión recién iniciada, antes
 * de `/auth/me`) se asume que sí: esconder de más confundiría, y el servidor
 * rechaza con 402 lo que no corresponda.
 */
export function hasChannel(access: PlanAccess | null, channel: Channel): boolean {
  if (!access) return true;
  return channel === 'pos' ? access.pos : access.store;
}

/**
 * La primera pantalla que le corresponde a la sesión, con permiso Y mitad.
 * Cada destino cumple lo que pide su ruta, así que redirigir aquí nunca hace un ciclo.
 */
export function homeRouteFor(can: (p: Permission) => boolean, has: (c: Channel) => boolean): string {
  if (can(PERM.dashboardView)) return '/dashboard';
  if (can(PERM.posSell) && has('pos')) return '/dashboard/cobrar';
  if (can(PERM.devicesUnlock) && has('pos')) return '/dashboard/escanear';
  if (can(PERM.productsRead)) return '/dashboard/products';
  return '/login';
}

// ── Sobrescribir el plan en desarrollo ──────────────────────────────

/** Clave de `localStorage` con el estado de ejemplo. Solo se lee fuera de producción. */
export const PLAN_OVERRIDE_KEY = 'znvx_plan_dev';

const DAY = 86_400_000;

function base(over: Partial<PlanAccess>): PlanAccess {
  return {
    state: 'active', plan: null, channel: null,
    store: true, pos: true, store_public: true, delivery: true, sales_export: true,
    max_products: null, max_users: null, read_only: false,
    trial_ends_at: null, trial_days_left: null,
    ...over,
  };
}

function trial(daysLeft: number, now: number): PlanAccess {
  return base({ state: 'trial', trial_ends_at: new Date(now + daysLeft * DAY).toISOString(), trial_days_left: daysLeft });
}

function starter(channel: Channel, over: Partial<PlanAccess> = {}): PlanAccess {
  return base({
    plan: 'starter', channel, store: channel === 'store', pos: channel === 'pos', store_public: channel === 'store',
    delivery: false, sales_export: false, max_products: 50, max_users: 2, ...over,
  });
}

/**
 * Los estados de la guía, tal como los mandaría el servidor (`core/plans.py`
 * `access_for`). Las fechas se calculan al leerlos.
 */
export const DEV_PLAN_PRESETS: Record<string, (now: number) => PlanAccess> = {
  /** Prueba con días de sobra: banner discreto. */
  'prueba': now => trial(18, now),
  /** Prueba con 7 días o menos: banner amarillo. */
  'prueba-por-vencer': now => trial(5, now),
  /** Último día de la prueba: banner rojo. */
  'prueba-ultimo-dia': now => trial(1, now),
  'starter-pos': () => starter('pos'),
  'starter-tienda': () => starter('store'),
  'pro': () => base({ plan: 'pro' }),
  'pro-desde-pos': () => base({ plan: 'pro', channel: 'pos' }),
  'enterprise': () => base({ plan: 'enterprise' }),
  /** Venció la prueba sin pagar: ve todo, no cambia nada, la tienda no se ve. */
  'vencido': now => base({
    state: 'expired', read_only: true, store_public: false,
    trial_ends_at: new Date(now - 3 * DAY).toISOString(),
  }),
  /** Canceló su Starter de POS: ve lo que tenía, en solo lectura. */
  'cancelado': () => starter('pos', { state: 'expired', read_only: true, store_public: false }),
};

/**
 * Lee lo guardado en `localStorage`: el nombre de un estado de ejemplo
 * (`starter-pos`) o un JSON con los campos a cambiar sobre la prueba
 * (`{"read_only": true}`). Algo ilegible se ignora.
 */
export function parsePlanOverride(raw: string | null, now = Date.now()): PlanAccess | null {
  if (!raw) return null;
  const preset = DEV_PLAN_PRESETS[raw.trim()];
  if (preset) return preset(now);
  try {
    const value = JSON.parse(raw);
    return value && typeof value === 'object' ? { ...trial(30, now), ...value } : null;
  } catch {
    return null;
  }
}
