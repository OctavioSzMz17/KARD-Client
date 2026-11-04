/**
 * Permisos y puestos, tal como los define el servidor (`core/permissions.py`).
 *
 * La pantalla los usa SOLO para mostrar u ocultar: el servidor vuelve a
 * comprobar cada operación, así que esconder un botón nunca es la protección.
 * Los permisos reales de la sesión llegan del servidor al iniciar sesión y en
 * `/auth/me`; la lista de aquí solo cubre sesiones guardadas antes de que
 * existieran (ver `fallbackPermissions`).
 */

export const PERM = {
  posSell: 'pos:sell',
  productsRead: 'products:read',
  productsWrite: 'products:write',
  inventoryAdjust: 'inventory:adjust',
  cashView: 'cash:view',
  cashManage: 'cash:manage',
  salesRead: 'sales:read',
  salesManage: 'sales:manage',
  teamManage: 'team:manage',
  settingsManage: 'settings:manage',
  billingManage: 'billing:manage',
  dashboardView: 'dashboard:view',
  devicesAuthorize: 'devices:authorize',
  devicesUnlock: 'devices:unlock',
} as const;

export type Permission = (typeof PERM)[keyof typeof PERM];

/** De más a menos autoridad. */
export const POSITIONS = ['dueno', 'gerente', 'subgerente', 'encargado_area', 'empleado'] as const;
export type Position = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<Position, string> = {
  dueno: 'Dueño',
  gerente: 'Gerente',
  subgerente: 'Subgerente',
  encargado_area: 'Encargado de área',
  empleado: 'Empleado',
};

const EMPLOYEE: Permission[] = [PERM.posSell, PERM.productsRead, PERM.cashView, PERM.devicesUnlock];

/**
 * Permisos de una sesión guardada ANTES de que el servidor los mandara.
 * Un dueño (`business_admin`) tenía todo; el personal, solo lo básico. Ante la
 * duda, menos permisos. En cuanto la pantalla consulta `/auth/me`, esto deja de usarse.
 */
export function fallbackPermissions(role: string | undefined): Permission[] {
  return role === 'business_admin' || role === 'saas_admin' ? Object.values(PERM) : EMPLOYEE;
}

/** Nivel jerárquico: 0 es el dueño; mayor = menos autoridad. */
export function levelOf(position: string): number {
  const i = (POSITIONS as readonly string[]).indexOf(position);
  return i === -1 ? POSITIONS.length - 1 : i;
}

/** Texto para mostrar de un puesto; un valor desconocido se muestra tal cual. */
export function positionLabel(position: string | undefined): string {
  return POSITION_LABELS[position as Position] ?? position ?? '';
}
