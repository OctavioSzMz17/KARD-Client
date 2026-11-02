/**
 * Piezas sin pantalla del módulo Equipo, para poder probarlas con números.
 */

/** Sin 0/O, 1/l/I: la contraseña inicial se dicta o se lee en una pantalla ajena. */
const LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
const DIGITS = '23456789';

/**
 * Contraseña inicial de 12 caracteres con letras y números (lo que exige el
 * servidor), generada con aleatoriedad criptográfica.
 */
export function generatePassword(length = 12): string {
  const alphabet = LETTERS + DIGITS;
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  const chars = Array.from(bytes, b => alphabet[b % alphabet.length]);

  // Garantiza que haya al menos una letra y un número, sin sesgar el resto.
  const slots = new Uint32Array(2);
  crypto.getRandomValues(slots);
  chars[slots[0] % length] = LETTERS[bytes[0] % LETTERS.length];
  let d = slots[1] % length;
  if (d === slots[0] % length) d = (d + 1) % length;
  chars[d] = DIGITS[bytes[1] % DIGITS.length];
  return chars.join('');
}

/** Mensaje si la contraseña no cumple lo que pide el servidor; null si está bien. */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (!/\d/.test(password)) return 'La contraseña debe llevar al menos un número.';
  if (!/[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(password)) return 'La contraseña debe llevar al menos una letra.';
  return null;
}

/** Iniciales para el avatar: "Eva López Ruiz" → "EL"; sin nombre, la inicial del correo. */
export function initialsOf(name: string | null | undefined, email = ''): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (email[0] ?? '?').toUpperCase();
}
