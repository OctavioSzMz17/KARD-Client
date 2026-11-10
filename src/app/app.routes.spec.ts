/**
 * Prueba del cliente PC-23 — rutas de recuperar la contraseña
 *
 * Son públicas por diseño (las usa quien no puede iniciar sesión) y cada una debe abrir la
 * pantalla en su modo: /recuperar pide el enlace, /restablecer crea la contraseña nueva.
 */

import { describe, expect, it } from 'vitest';

import { routes } from './app.routes';

describe('PC-23 · rutas de recuperar la contraseña', () => {
  const ruta = (path: string) => routes.find(r => r.path === path);

  it('/recuperar abre la pantalla en modo "pedir el enlace"', () => {
    expect(ruta('recuperar')?.data).toEqual({ mode: 'ask' });
  });

  it('/restablecer abre la pantalla en modo "contraseña nueva"', () => {
    expect(ruta('restablecer')?.data).toEqual({ mode: 'reset' });
  });

  it('las dos son públicas: no piden sesión ni permisos', () => {
    for (const path of ['recuperar', 'restablecer']) {
      expect(ruta(path)?.canActivate, path).toBeUndefined();
      expect(ruta(path)?.loadComponent, path).toBeTypeOf('function');
    }
  });

  it('se carga el componente de recuperación', async () => {
    const { PasswordRecoveryComponent } = await import('./auth/password-recovery/password-recovery.component');
    expect(await ruta('recuperar')!.loadComponent!()).toBe(PasswordRecoveryComponent);
    expect(await ruta('restablecer')!.loadComponent!()).toBe(PasswordRecoveryComponent);
  });
});
