import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { PlanNoticeService } from '../services/plan-notice.service';
import { PlanStore } from '../store/plan.store';
import { Channel } from '../models/plan.models';
import { Permission } from '../permissions';
import { lockedNotice } from '../plan-notice.logic';

/** Rutas del dashboard B2B: exige sesión de negocio (no consumer). */
export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  if (auth.isConsumer()) {
    // un consumer no puede entrar al dashboard aunque escriba la URL
    router.navigate(['/explore']);
    return false;
  }

  return true;
};

/** Rutas del cliente B2C: exige sesión de consumer. */
export const consumerGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isLoggedIn()) {
    router.navigate(['/login']);
    return false;
  }

  if (!auth.isConsumer()) {
    // un usuario de negocio no pertenece a la vista de cliente
    router.navigate(['/dashboard']);
    return false;
  }

  return true;
};

/**
 * Pantalla del panel que exige un permiso y, si se indica, una mitad del plan
 * (Cobrar = `pos:sell` + `pos`). Quien no puede entrar no ve un error: lo
 * mandamos a la primera pantalla que sí le toca. Si lo que falta es la mitad,
 * el dueño además ve el aviso de qué incluye Pro; el equipo solo cambia de pantalla.
 *
 * Es comodidad, no seguridad: aunque alguien escribiera la dirección o
 * cambiara lo guardado en su navegador, el servidor rechaza cada operación que
 * su puesto (403) o su plan (402) no permite.
 */
export const permissionGuard = (permission: Permission, channel?: Channel): CanActivateFn => () => {
  const auth = inject(AuthService);
  const plan = inject(PlanStore);
  const router = inject(Router);

  if (!auth.can(permission)) return router.parseUrl(plan.homeRoute());
  if (!channel || plan.has(channel)) return true;

  if (plan.isOwner()) inject(PlanNoticeService).show(lockedNotice(channel, true));
  return router.parseUrl(plan.homeRoute());
};
