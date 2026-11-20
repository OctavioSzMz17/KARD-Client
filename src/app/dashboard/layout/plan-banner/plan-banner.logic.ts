/**
 * Qué banner superior toca según el estado de la cuenta (§11 de
 * `docs/Planes_contrato_frontend.md`). Uno solo a la vez. Lógica pura: lee
 * `PlanAccess` (y, para el dueño, el estado de Stripe) y no decide reglas.
 */
import { PlanAccess } from '../../../core/models/plan.models';

export type BannerTone = 'neutral' | 'warning' | 'danger';

export interface PlanBanner {
  /** Identifica el aviso para recordar que se cerró (solo los que no son fijos). */
  key: string;
  tone: BannerTone;
  text: string;
  /** Botón hacia Suscripción. Solo el dueño lo ve. */
  action?: string;
  /** Fijo = no se puede cerrar: la cuenta no puede operar. */
  fixed: boolean;
}

const TEAM_TAIL = 'Avísale al dueño.';

/**
 * El banner para el estado de la cuenta, o `null` si no hay nada que avisar
 * (cuenta activa al día, o plan aún desconocido).
 *
 * El equipo ve el mismo color con otro texto, sin botón: no paga, solo avisa.
 * La prueba con días de sobra y el pago atrasado no le tocan (no puede hacer
 * nada y su acceso sigue igual).
 */
export function bannerFor(access: PlanAccess | null, subscriptionStatus: string | null, isOwner: boolean): PlanBanner | null {
  if (!access) return null;

  if (access.state === 'expired') {
    const canceled = access.plan !== null;
    if (!isOwner) {
      return { key: 'expired', tone: 'danger', fixed: true, text: `La cuenta del negocio está en solo lectura. ${TEAM_TAIL}` };
    }
    return canceled
      ? { key: 'expired', tone: 'danger', fixed: true, text: 'Tu suscripción no está activa. Tu tienda no se ve en línea.', action: 'Reactivar' }
      : { key: 'expired', tone: 'danger', fixed: true, text: 'Tu prueba terminó. Tus datos están a salvo, pero no puedes vender ni editar.', action: 'Elegir plan' };
  }

  if (access.state === 'trial') {
    const days = access.trial_days_left ?? 0;
    if (days <= 1) {
      return isOwner
        ? { key: 'trial-today', tone: 'danger', fixed: false, text: 'Tu prueba termina hoy.', action: 'Elegir plan' }
        : { key: 'trial-today', tone: 'danger', fixed: false, text: `La prueba del negocio termina hoy. ${TEAM_TAIL}` };
    }
    if (days <= 7) {
      return isOwner
        ? { key: `trial-${days}`, tone: 'warning', fixed: false, text: `Tu prueba termina en ${days} días. Elige un plan para no perder el acceso.`, action: 'Elegir plan' }
        : { key: `trial-${days}`, tone: 'warning', fixed: false, text: `La prueba del negocio termina en ${days} días. ${TEAM_TAIL}` };
    }
    return isOwner
      ? { key: 'trial', tone: 'neutral', fixed: false, text: `Prueba gratis: te quedan ${days} días`, action: 'Ver planes' }
      : null;
  }

  if (isOwner && subscriptionStatus === 'past_due') {
    return {
      key: 'past-due', tone: 'warning', fixed: false,
      text: 'No pudimos cobrar tu renovación. Actualiza tu tarjeta para no perder el acceso.', action: 'Actualizar pago',
    };
  }

  return null;
}
