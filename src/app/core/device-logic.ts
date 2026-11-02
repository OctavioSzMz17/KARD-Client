/**
 * Piezas sin pantalla del acceso por QR y los equipos autorizados, para poder
 * probarlas con números. Sin Angular: funciones puras y el almacenamiento del
 * token del equipo.
 */

const DEVICE_KEY = 'kard_device';

/** El equipo que la gerencia autorizó, tal como se guarda en este navegador. */
export interface StoredDevice {
  token: string;
  name: string;
  /** ISO-8601: cuándo vence la autorización. */
  expires_at: string;
}

/** ¿Venció (o no tiene fecha válida)? Ante la duda, vencido. */
export function isExpired(expiresAt: string | null | undefined, now: number = Date.now()): boolean {
  const t = Date.parse(expiresAt ?? '');
  return Number.isNaN(t) || t <= now;
}

/** Segundos que faltan, sin bajar de cero. */
export function secondsLeft(expiresAt: string | null | undefined, now: number = Date.now()): number {
  const t = Date.parse(expiresAt ?? '');
  return Number.isNaN(t) ? 0 : Math.max(0, Math.ceil((t - now) / 1000));
}

/** "2:05" para mostrar la cuenta regresiva del QR. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ── Token del equipo (localStorage) ─────────────────────────────────

/** El equipo guardado en este navegador, o null si no hay o está dañado. */
export function readDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(DEVICE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<StoredDevice>;
    return typeof d.token === 'string' && typeof d.name === 'string' && typeof d.expires_at === 'string'
      ? (d as StoredDevice)
      : null;
  } catch {
    return null;
  }
}

export function saveDevice(device: StoredDevice): void {
  localStorage.setItem(DEVICE_KEY, JSON.stringify(device));
}

export function clearDevice(): void {
  localStorage.removeItem(DEVICE_KEY);
}

/**
 * El token para mandar en la cabecera, solo si el equipo sigue vigente según
 * este navegador. (El servidor lo vuelve a comprobar siempre.)
 */
export function activeDeviceToken(now: number = Date.now()): string | null {
  const d = readDevice();
  return d && !isExpired(d.expires_at, now) ? d.token : null;
}

// ── Lo que lleva el QR ──────────────────────────────────────────────

/** Un identificador de desafío: aleatorio y largo (base64 URL-safe). */
const CHALLENGE_ID = /^[A-Za-z0-9_-]{16,40}$/;

/** Dirección que lleva el QR. El identificador va en el fragmento (#), que nunca viaja al servidor. */
export function approvalUrl(origin: string, challengeId: string): string {
  return `${origin.replace(/\/$/, '')}/dashboard/aprobar#${challengeId}`;
}

/**
 * Saca el identificador de lo que leyó el escáner: la dirección completa del
 * QR o el identificador a secas. null si no tiene la forma de uno — un QR
 * cualquiera (el de un producto, el de un tercero) nunca se manda al servidor.
 */
export function parseChallengeId(raw: string | null | undefined): string | null {
  const text = (raw ?? '').trim();
  if (!text) return null;

  const hash = text.includes('#') ? text.slice(text.lastIndexOf('#') + 1) : text;
  let id: string;
  try {
    id = decodeURIComponent(hash).trim();
  } catch {
    return null;                       // un "%" suelto: no es un identificador
  }
  if (!CHALLENGE_ID.test(id)) return null;

  // Si venía como dirección, tiene que ser la de aprobación de KARD.
  if (text.includes('#') && !/\/dashboard\/aprobar#/.test(text)) return null;
  return id;
}

// ── Secreto de la computadora ───────────────────────────────────────

/** 32 bytes aleatorios en hexadecimal: el secreto que solo esta computadora conoce. */
export function randomSecret(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** SHA-256 en hexadecimal: al servidor solo se le manda el hash del secreto. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

// ── Bloqueo por inactividad ─────────────────────────────────────────

/** Minutos sin tocar la caja antes de bloquearla. */
export const IDLE_LOCK_MINUTES = 10;

/**
 * Cuenta el tiempo sin actividad. Sin temporizadores propios: quien la usa
 * llama a `touch()` con cada gesto y consulta `shouldLock()` de vez en cuando,
 * así se prueba sin esperar.
 */
export class IdleClock {
  private last: number;

  constructor(
    private readonly limitMs = IDLE_LOCK_MINUTES * 60_000,
    now: number = Date.now(),
  ) {
    this.last = now;
  }

  touch(now: number = Date.now()): void {
    this.last = now;
  }

  shouldLock(now: number = Date.now()): boolean {
    return now - this.last >= this.limitMs;
  }
}
