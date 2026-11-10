/** Lógica pura de la pantalla de recuperar contraseña (sin Angular, para probarla directo). */

/** Cómo luce un enlace de recuperación: lo que genera el servidor (`secrets.token_urlsafe`). */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{20,200}$/;

/**
 * Saca el token del fragmento de la dirección (`#token=...`).
 *
 * El enlace del correo lleva el token después del `#`, que el navegador no manda al servidor. Si
 * falta, está cortado o tiene caracteres raros, devuelve null: la pantalla pide uno nuevo en vez de
 * mandar al servidor algo que sabemos que no sirve.
 */
export function tokenFromFragment(fragment: string | null | undefined): string | null {
  if (!fragment) return null;
  const token = new URLSearchParams(fragment.replace(/^#/, '')).get('token');
  return token && TOKEN_SHAPE.test(token) ? token : null;
}

/** La misma regla que el registro: 8 o más caracteres, con una letra y un número. */
export const PASSWORD_RULE = /^(?=.*[a-zA-Z])(?=.*\d).+$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_HINT = 'Mínimo 8 caracteres, con letras y números';

/** El mensaje, en español, de lo que respondió el servidor. */
export function recoveryErrorMessage(status: number, code?: string | null): string {
  if (status === 0) return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
  if (status === 400 && code === 'INVALID_RESET_TOKEN') return 'El enlace ya no es válido. Pide uno nuevo.';
  if (status === 422) return 'Revisa los datos: alguno no tiene el formato esperado.';
  if (status >= 500) return 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.';
  return 'No se pudo completar la solicitud. Intenta de nuevo.';
}
