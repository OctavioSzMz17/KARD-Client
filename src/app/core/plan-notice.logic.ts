/**
 * De un error del plan (402/409) al aviso que ve la persona, según la guía
 * (§17 de `docs/Planes_contrato_frontend.md`). Lógica pura, sin Angular.
 *
 * El dueño ve qué hacer (elegir plan, pasar a Pro, liberar espacio); el resto
 * del equipo, un solo mensaje: avisarle al dueño. A un cajero nunca se le ofrece pagar.
 */
import {
  BILLING_CONFLICT_CODES, BillingConflict, BillingConflictCode, Channel,
  PLAN_ERROR_CODES, PlanError, PlanErrorCode,
} from './models/plan.models';

/**
 * Qué hace un botón del aviso. `upgrade` es "pasar a Pro": abre el modal de
 * mejora (flujo 15B) ahí mismo, sin perder lo capturado.
 */
export type NoticeAction = 'plans' | 'upgrade' | 'products' | 'team' | 'close';

export interface NoticeButton {
  label: string;
  action: NoticeAction;
}

export interface PlanNotice {
  /** De qué error salió; `locked` es un candado del menú. */
  code: PlanErrorCode | BillingConflictCode | 'locked';
  title: string;
  message: string;
  primary: NoticeButton;
  secondary?: NoticeButton;
}

/** Un error de la API que habla del plan: 402 con su `code`, o 409 de cobro. */
export type PlanApiError =
  | { status: 402; body: PlanError }
  | { status: 409; body: BillingConflict };

/** Reconoce un error del plan por estado y `code`; cualquier otro 402/409 (p. ej. falta de stock) no es suyo. */
export function asPlanError(status: number, body: unknown): PlanApiError | null {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  if (status === 402 && (PLAN_ERROR_CODES as readonly string[]).includes(code)) {
    return { status, body: body as PlanError };
  }
  if (status === 409 && (BILLING_CONFLICT_CODES as readonly string[]).includes(code)) {
    return { status, body: body as BillingConflict };
  }
  return null;
}

const CLOSE: NoticeButton = { label: 'Entendido', action: 'close' };
const LATER: NoticeButton = { label: 'Cerrar', action: 'close' };

const FEATURE_TITLE: Record<string, string> = {
  pos: 'El punto de venta es parte de Pro',
  store: 'La tienda en línea es parte de Pro',
  delivery: 'Los envíos son parte de Pro',
};

const FEATURE_MESSAGE: Record<string, string> = {
  pos: 'Con Pro cobras en el mostrador con el mismo inventario: caja, ticket y corte.',
  store: 'Con Pro tu tienda en línea se activa con tu mismo catálogo.',
  delivery: 'Con Pro puedes ofrecer envío a domicilio.',
};

/** Lo que ve el equipo ante cualquier 402. */
function teamNotice(code: PlanErrorCode | 'locked'): PlanNotice {
  return {
    code,
    title: code === 'read_only'
      ? 'La cuenta del negocio está en solo lectura'
      : 'Esta función no está disponible en el plan del negocio',
    message: 'Avísale al dueño.',
    primary: CLOSE,
  };
}

/** El candado de una mitad que el plan no incluye (menú o dirección escrita a mano). */
export function lockedNotice(channel: Channel, isOwner: boolean): PlanNotice {
  if (!isOwner) return teamNotice('locked');
  return {
    code: 'locked',
    title: FEATURE_TITLE[channel],
    message: FEATURE_MESSAGE[channel],
    primary: { label: 'Ver Pro', action: 'upgrade' },
    secondary: LATER,
  };
}

/** "12 de diciembre", en la zona del navegador. */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long' }).format(d);
}

/**
 * El aviso para un error del plan, o `null` si no lleva modal: los 409 de cobro
 * que solo indican una llamada equivocada los resuelve la pantalla que llamó.
 */
export function noticeFor(error: PlanApiError, isOwner: boolean): PlanNotice | null {
  if (error.status === 402) {
    const body = error.body;
    if (!isOwner) return teamNotice(body.code);

    switch (body.code) {
      case 'read_only':
        return {
          code: body.code,
          title: 'Tu cuenta está en solo lectura',
          message: body.error,
          primary: { label: 'Elegir plan', action: 'plans' },
          secondary: LATER,
        };
      case 'feature_locked':
        return {
          code: body.code,
          title: FEATURE_TITLE[body.feature] ?? 'Esta función es parte de Pro',
          message: body.error,
          primary: { label: 'Ver Pro', action: 'upgrade' },
          secondary: LATER,
        };
      case 'limit_reached': {
        const users = body.limit === 'users';
        return {
          code: body.code,
          title: users ? `Tu equipo llegó a ${body.max} personas` : `Llegaste a ${body.max} productos`,
          message: body.error,
          primary: { label: 'Pasar a Pro', action: 'upgrade' },
          secondary: users
            ? { label: 'Administrar equipo', action: 'team' }
            : { label: 'Administrar productos', action: 'products' },
        };
      }
    }
  }

  const body = error.body;
  if (body.code === 'channel_cooldown') {
    return {
      code: body.code,
      title: `Podrás cambiar el ${formatDay(body.available_at)}`,
      message: body.error,
      primary: CLOSE,
    };
  }
  return null;
}
