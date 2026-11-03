import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { Permission } from '../permissions';

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
 * Pantalla del panel que exige un permiso. Quien no lo tiene no ve un error: lo
 * mandamos a la primera pantalla que sí le toca.
 *
 * Es comodidad, no seguridad: aunque alguien escribiera la dirección o
 * cambiara lo guardado en su navegador, el servidor rechaza cada operación que
 * su puesto no permite.
 */
export const permissionGuard = (permission: Permission): CanActivateFn => () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.can(permission)) return true;

  const home = auth.homeRoute();
  return router.parseUrl(home);
};
