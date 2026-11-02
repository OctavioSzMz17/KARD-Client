import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';
import { DeviceService } from '../services/device.service';
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

/**
 * Cobrar exige un equipo autorizado hoy para encargados y empleados. Quien no
 * lo tiene va a la pantalla de la caja registradora, donde la gerencia puede
 * autorizarlo. Dueño, gerente y subgerente pasan siempre.
 *
 * Igual que los demás guards, esto es comodidad: el servidor rechaza el cobro
 * desde un equipo no autorizado aunque se llegue a esta pantalla.
 */
export const deviceGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const device = inject(DeviceService);
  const router = inject(Router);

  if (!auth.needsDevice() || device.isAuthorized()) return true;
  return router.parseUrl('/caja-registradora');
};
