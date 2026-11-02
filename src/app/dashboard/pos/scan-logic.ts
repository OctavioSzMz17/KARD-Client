/**
 * Reglas del escáner de cámara, sin cámara ni navegador: así se prueban con
 * números y no con dispositivos.
 */

/** El servidor rechaza códigos de más de 120 caracteres: no tiene caso preguntarle. */
export const MAX_CODE_LENGTH = 120;

/** Limpia lo que entrega el lector; null si no sirve para buscar un producto. */
export function cleanScan(raw: string | null | undefined): string | null {
  const code = (raw ?? '').trim();
  if (!code || code.length > MAX_CODE_LENGTH) return null;
  return code;
}

/**
 * Cuánto tiempo sin verse tiene que pasar para que el mismo código cuente de
 * nuevo. Es lo que tarda alguien en apartar el producto del cuadro y volver a
 * apuntarlo; un parpadeo de un cuadro o dos no llega a esto.
 */
export const SAME_CODE_RELEASE_MS = 1200;

/**
 * Filtro contra lecturas repetidas.
 *
 * Con la cámara en vivo, un solo producto frente al lente genera la misma
 * lectura en cada cuadro. Sin filtro, un taco se cobraría veinte veces. Un
 * código DISTINTO cuenta de inmediato (para escanear varios seguidos). El
 * MISMO solo cuenta otra vez si dejó de verse un momento: apartar el producto
 * y volver a apuntarlo es "otro taco"; seguir apuntando al mismo no lo es.
 *
 * Por eso cada vez que se VE un código, aunque no cuente, se renueva la
 * última vez que se vio: quedarse apuntando no lo libera nunca.
 */
export class ScanDebouncer {
  private lastSeen = new Map<string, number>();

  constructor(private readonly releaseMs = SAME_CODE_RELEASE_MS) {}

  /** `true` si la lectura cuenta; `false` si es el mismo código que sigue a la vista. */
  accept(code: string, now: number = Date.now()): boolean {
    const last = this.lastSeen.get(code);
    this.lastSeen.set(code, now);
    this.prune(now);
    return last === undefined || now - last >= this.releaseMs;
  }

  /** Olvida lo viejo para que la tabla no crezca durante un turno largo. */
  private prune(now: number): void {
    if (this.lastSeen.size < 50) return;
    for (const [code, at] of this.lastSeen) {
      if (now - at >= this.releaseMs) this.lastSeen.delete(code);
    }
  }
}

/** Lo que muestra el escáner sobre la imagen tras cada lectura. */
export interface ScanStatus {
  /** Número de lectura: cambia con cada una, para que la animación se repita. */
  n: number;
  ok: boolean;
  text: string;
}

/** Formatos que se piden al lector: los de tienda (EAN/UPC), Code 128 de las etiquetas y QR. */
export const SCAN_FORMATS = ['qr_code', 'code_128', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_39', 'itf'] as const;

/** Formatos sin los cuales el lector nativo no sirve: obligan a usar el de respaldo. */
export const REQUIRED_NATIVE_FORMATS = ['qr_code', 'code_128', 'ean_13'] as const;

/**
 * ¿Sirve el lector nativo del navegador? Solo si entiende al menos los
 * formatos imprescindibles; si no, se usa el de respaldo (que sí los lee).
 */
export function nativeIsEnough(supported: readonly string[]): boolean {
  return REQUIRED_NATIVE_FORMATS.every(f => supported.includes(f));
}
