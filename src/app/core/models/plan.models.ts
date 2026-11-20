/**
 * Tipos del contrato de planes, tal como los manda el backend
 * (repo KARD, `core/plans.py` y `billing/models.py`; guía en
 * `docs/Planes_contrato_frontend.md`).
 *
 * La pantalla no calcula reglas: lee estas banderas ya resueltas y reacciona a
 * los errores 402/409. El servidor las vuelve a aplicar en cada petición.
 */

export type Plan = 'starter' | 'pro' | 'enterprise';

/** La mitad de ZNVX BX que incluye Starter: tienda en línea o punto de venta. */
export type Channel = 'store' | 'pos';

export type AccessState = 'trial' | 'active' | 'expired';

/** §2. Lo que el negocio puede usar ahora mismo. Llega en `/auth/me` (`plan`) y en `/billing/plan` (`access`). */
export interface PlanAccess {
  state: AccessState;
  /** `null` en la prueba o si nunca pagó. */
  plan: Plan | null;
  /** La mitad de Starter, que se conserva en Pro. */
  channel: Channel | null;
  store: boolean;
  pos: boolean;
  /** La tienda se ve en público AHORA (se apaga en solo lectura). */
  store_public: boolean;
  delivery: boolean;
  sales_export: boolean;
  /** `null` = sin tope. */
  max_products: number | null;
  max_users: number | null;
  read_only: boolean;
  /** ISO 8601. */
  trial_ends_at: string | null;
  trial_days_left: number | null;
}

/** Cuánto ocupa el negocio de lo que su plan permite (los topes vienen en `access`). */
export interface PlanUsage {
  products: number;
  users: number;
}

/** §4. `GET /billing/plan`: solo el dueño (`billing:manage`). */
export interface PlanInfo {
  plan: Plan | null;
  subscription_status: string;
  current_period_end: string | null;
  /** Puede operar (incluye la prueba). `false` en solo lectura. */
  has_access: boolean;
  /** `false` → `checkout` (pago nuevo); `true` → `change-plan` (prorrateo). */
  has_subscription: boolean;
  access: PlanAccess | null;
  usage: PlanUsage | null;
  /** `null` = ya puede cambiar de mitad; una fecha ISO = desde cuándo. */
  channel_change_available_at: string | null;
}

/** §5.1. Respuesta de `POST /billing/checkout`. */
export interface CheckoutResponse {
  checkout_url: string;
  plan: Plan;
}

/** §5.2. Respuesta de `GET /billing/change-plan/preview`. */
export interface ChangePlanPreview {
  plan: Plan;
  channel: Channel | null;
  direction: 'upgrade' | 'downgrade';
  /** Subir: se cobra hoy. Bajar: nada hoy, `amount` es la siguiente factura. */
  charged_now: boolean;
  /** Decimal serializado como texto, p. ej. `"180.00"`. */
  amount: string;
  currency: string;
  /** Mandarla igual al confirmar: Stripe prorratea al segundo. */
  proration_date: number;
  current_period_end: string | null;
}

/** §5.2. Respuesta de `POST /billing/change-plan`. */
export interface ChangePlanResponse {
  /** `payment_pending`: el banco rechazó o pidió verificación. El plan NO cambió. */
  status: 'applied' | 'payment_pending';
  plan: Plan | null;
  channel: Channel | null;
  payment_url: string | null;
  access: PlanAccess;
}

// ── Errores (§3) ────────────────────────────────────────────────────

/** Toda respuesta de error de la API trae este cuerpo. */
interface ApiErrorBody {
  success: false;
  /** Mensaje para mostrar, ya en español. */
  error: string;
}

/** 402: el plan no alcanza. */
export type PlanError =
  | (ApiErrorBody & { code: 'read_only' })
  | (ApiErrorBody & { code: 'feature_locked'; feature: 'pos' | 'store' | 'delivery' | string })
  | (ApiErrorBody & { code: 'limit_reached'; limit: 'products' | 'users'; max: number });

export type PlanErrorCode = PlanError['code'];

/** 409: la operación de cobro no corresponde al estado de la suscripción. */
export type BillingConflictCode =
  | 'subscription_exists'
  | 'no_subscription'
  | 'channel_required'
  | 'same_plan'
  | 'use_channel_change'
  | 'channel_cooldown'
  | 'not_starter'
  | 'same_channel';

export type BillingConflict =
  | (ApiErrorBody & { code: Exclude<BillingConflictCode, 'channel_cooldown'> })
  | (ApiErrorBody & { code: 'channel_cooldown'; available_at: string });

export const PLAN_ERROR_CODES: readonly PlanErrorCode[] = ['read_only', 'feature_locked', 'limit_reached'];

export const BILLING_CONFLICT_CODES: readonly BillingConflictCode[] = [
  'subscription_exists', 'no_subscription', 'channel_required', 'same_plan',
  'use_channel_change', 'channel_cooldown', 'not_starter', 'same_channel',
];
