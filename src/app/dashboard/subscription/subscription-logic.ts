/**
 * Lógica pura de la pantalla de Suscripción (§14 y §15 de
 * `docs/Planes_contrato_frontend.md`): qué dice y qué hace el botón de cada
 * plan, y los textos de las mitades. No decide reglas: lee `PlanInfo`.
 */
import { Channel, Plan, PlanInfo } from '../../core/models/plan.models';

/** Un plan tal como se presenta al negocio. */
export interface PlanCard {
  key: Plan;
  nombre: string;
  /**
   * Solo texto: el importe que de verdad se cobra es el precio configurado en
   * Stripe. Si cambias uno allá, actualiza este a mano.
   */
  precio: number;
  resumen: string;
  incluye: string[];
  destacado?: boolean;
}

export const PLAN_CARDS: PlanCard[] = [
  {
    key: 'starter', nombre: 'Starter', precio: 299,
    resumen: 'Para negocios que empiezan: elige punto de venta o tienda en línea.',
    incluye: ['Una mitad: punto de venta o tienda en línea', 'Hasta 50 productos', 'Hasta 2 personas en el equipo', 'Inventario y alertas de stock bajo'],
  },
  {
    key: 'pro', nombre: 'Pro', precio: 599, destacado: true,
    resumen: 'Para quien ya vende todos los días.',
    incluye: ['Punto de venta y tienda en línea', 'Productos y equipo sin límite', 'Envíos a domicilio', 'Reporte de ventas descargable', 'Recetas con descuento en cascada'],
  },
  {
    key: 'enterprise', nombre: 'Enterprise', precio: 1199,
    resumen: 'Para cadenas con varias sucursales.',
    incluye: ['Todo lo de Pro', 'Varias sucursales', 'Soporte prioritario', 'Acceso anticipado a nuevas funciones'],
  },
];

/** Las dos mitades de Starter, con el texto de la guía (§15A). */
export const CHANNEL_OPTIONS: { key: Channel; nombre: string; detalle: string }[] = [
  { key: 'pos', nombre: 'Punto de venta', detalle: 'Cobra en tu mostrador con caja, ticket y corte.' },
  { key: 'store', nombre: 'Tienda en línea', detalle: 'Recibe pedidos en tu tienda y aparece en Explorar.' },
];

/** La otra mitad. */
export function otherChannel(channel: Channel): Channel {
  return channel === 'pos' ? 'store' : 'pos';
}

/**
 * Textos para cambiar de mitad en Starter (§15D): qué deja de estar
 * disponible, que nada se borra, y que solo se puede una vez cada 30 días.
 */
export function channelSwitchCopy(target: Channel): { title: string; body: string; action: string } {
  const destino = channelName(target).toLowerCase();
  return {
    title: `¿Cambiar a ${destino}?`,
    body: target === 'store'
      ? 'Tu punto de venta dejará de estar disponible; tus ventas y cortes no se borran.'
      : 'Tu tienda en línea dejará de verse y no recibirás pedidos; tus productos y pedidos anteriores no se borran.',
    action: `Cambiar a ${destino}`,
  };
}

export function channelName(channel: Channel): string {
  return CHANNEL_OPTIONS.find(c => c.key === channel)!.nombre;
}

const RANK: Record<Plan, number> = { starter: 1, pro: 2, enterprise: 3 };

/**
 * Qué hace el botón: `checkout` = primer pago (15A); `upgrade`/`downgrade` =
 * cambio con prorrateo (15B/15C); `none` = es su plan.
 */
export type PlanButtonAction = 'checkout' | 'upgrade' | 'downgrade' | 'none';

export interface PlanButton {
  label: string;
  action: PlanButtonAction;
  disabled: boolean;
}

/**
 * El botón de una tarjeta según `has_subscription` (§14 C). Sin suscripción
 * vigente siempre es "Elegir", incluso si antes tuvo ese plan y lo canceló:
 * para volver hace un pago nuevo.
 */
export function planButton(card: PlanCard, info: PlanInfo | null): PlanButton {
  if (!info?.has_subscription) return { label: 'Elegir', action: 'checkout', disabled: false };

  if (info.plan === card.key) return { label: 'Tu plan', action: 'none', disabled: true };

  // Subir es el flujo 15B; bajar, el 15C. Los dos prorratean sobre la suscripción.
  const up = !info.plan || RANK[card.key] > RANK[info.plan];
  return up
    ? { label: `Subir a ${card.nombre}`, action: 'upgrade', disabled: false }
    : { label: `Cambiar a ${card.nombre}`, action: 'downgrade', disabled: false };
}

/** Topes de Starter, solo para explicar lo que cambia (los aplica el servidor). */
const STARTER_MAX_PRODUCTS = 50;
const STARTER_MAX_USERS = 2;

/**
 * Lo que pierde al bajar (§15C), concreto a su negocio: la mitad que deja, los
 * topes contra lo que ya tiene (nada se borra ni se da de baja) y las funciones
 * que se apagan. Para Starter, `channel` es la mitad que conservaría.
 */
export function downgradeLosses(target: Plan, channel: Channel | null, info: PlanInfo): string[] {
  if (target !== 'starter') {
    return target === 'pro' && info.plan === 'enterprise'
      ? ['Varias sucursales', 'Soporte prioritario']
      : [];
  }

  const losses: string[] = [];
  if (channel === 'pos') losses.push('Tu tienda dejará de verse en línea y no recibirás pedidos');
  if (channel === 'store') losses.push('El punto de venta deja de estar disponible; tus ventas y cortes no se borran');

  const products = info.usage?.products ?? 0;
  losses.push(products > STARTER_MAX_PRODUCTS
    ? `No podrás agregar más de ${STARTER_MAX_PRODUCTS} productos (tienes ${products}; ninguno se borra)`
    : `Hasta ${STARTER_MAX_PRODUCTS} productos`);

  const users = info.usage?.users ?? 0;
  losses.push(users > STARTER_MAX_USERS
    ? `Tu equipo queda en ${STARTER_MAX_USERS} personas (tienes ${users}; nadie se da de baja, pero no podrás agregar ni reactivar)`
    : `Hasta ${STARTER_MAX_USERS} personas en el equipo`);

  losses.push('Se apagan los envíos a domicilio', 'Ya no podrás descargar el reporte de ventas');
  if (info.plan === 'enterprise') losses.push('Varias sucursales', 'Soporte prioritario');
  return losses;
}

export function planCard(plan: Plan): PlanCard {
  return PLAN_CARDS.find(c => c.key === plan)!;
}

/**
 * Lo que gana al subir (§15B), concreto a lo que tiene hoy: la mitad que le
 * falta con su catálogo, los topes que se quitan y las funciones que se encienden.
 */
export function upgradeGains(target: Plan, info: PlanInfo): string[] {
  const a = info.access;
  const gains: string[] = [];
  if (a && !a.store) {
    const n = info.usage?.products ?? 0;
    gains.push(n > 0
      ? `Tu tienda en línea se activa con tu${n === 1 ? ' producto' : `s ${n} productos`}`
      : 'Tu tienda en línea se activa con tu catálogo');
  }
  if (a && !a.pos) gains.push('Cobra en el mostrador con el mismo inventario');
  if (a && (a.max_products !== null || a.max_users !== null)) gains.push('Productos y equipo sin límite');
  if (a && !a.delivery) gains.push('Envíos a domicilio');
  if (a && !a.sales_export) gains.push('Reporte de ventas descargable');
  if (target === 'enterprise') gains.push('Varias sucursales', 'Soporte prioritario');
  return gains;
}

/** "$180.00" (pesos con dos decimales). */
export function formatMoney(amount: string | number, currency = 'mxn'): string {
  const n = typeof amount === 'string' ? Number(amount) : amount;
  if (!Number.isFinite(n)) return String(amount);
  return new Intl.NumberFormat('es-MX', {
    style: 'currency', currency: currency.toUpperCase(), currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2,
  }).format(n);
}

/** La tarjeta del plan vigente (solo con suscripción: en la prueba o vencido no hay "Tu plan"). */
export function isCurrentPlan(card: PlanCard, info: PlanInfo | null): boolean {
  return !!info?.has_subscription && info.plan === card.key;
}

/** Cada cuánto y cuántas veces se pregunta si ya llegó el pago (§15A paso 5). */
export const ACTIVATION_POLL_MS = 2000;
export const ACTIVATION_POLL_TRIES = 5;
