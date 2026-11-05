/**
 * Lógica pura del ticket compartido entre la caja y el celular: sin Angular, sin HTTP.
 *
 * El ticket vive en el servidor. Cada pantalla manda operaciones (agregar, cambiar cantidad,
 * quitar, vaciar) y recibe el estado completo; así lo que se escanea en el celular aparece en la
 * computadora de la misma caja, y lo que se borra en una se borra en la otra.
 */

export interface TicketLine {
  product_id: string;
  quantity: number;
}

export interface TicketState {
  /** Identifica ESTE ticket: cambia al cobrarlo o vaciarlo. Es la llave de idempotencia del cobro. */
  uid: string;
  /** Sube con cada cambio. */
  rev: number;
  lines: TicketLine[];
}

export interface RegisterInfo {
  id: string;
  name: string;
}

export interface TicketResponse {
  /** null: esta sesión no opera ninguna caja, y su ticket se queda en su pantalla. */
  register: RegisterInfo | null;
  ticket: TicketState | null;
}

export type TicketOpType = 'add' | 'set_quantity' | 'remove' | 'clear';

export interface TicketOp {
  op_id: string;
  type: TicketOpType;
  product_id?: string;
  quantity?: number;
  /** Solo en `clear`: vacía únicamente si el ticket sigue siendo ese. */
  uid?: string;
}

/** Cada cuánto pregunta la pantalla si hay algo nuevo. */
export const POLL_MS = 1200;

/** Tope de unidades por producto; el mismo del servidor. */
export const MAX_QUANTITY = 999;

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

/** Llave de una operación: un reintento de red con la misma llave no se aplica dos veces. */
export function newOpId(): string {
  return `op-${randomHex(16)}`;
}

/**
 * Identificador de un ticket que NO está compartido (esta pantalla no opera ninguna caja).
 * Sirve igual como llave de idempotencia del cobro: un doble clic no cobra dos veces.
 */
export function localTicketUid(): string {
  return `loc-${randomHex(16)}`;
}

export const ops = {
  add: (productId: string, quantity = 1): TicketOp => ({ op_id: newOpId(), type: 'add', product_id: productId, quantity }),
  setQuantity: (productId: string, quantity: number): TicketOp => ({
    op_id: newOpId(), type: 'set_quantity', product_id: productId, quantity: Math.min(Math.max(quantity, 1), MAX_QUANTITY),
  }),
  remove: (productId: string): TicketOp => ({ op_id: newOpId(), type: 'remove', product_id: productId }),
  clear: (uid?: string): TicketOp => ({ op_id: newOpId(), type: 'clear', ...(uid ? { uid } : {}) }),
};

/**
 * Las líneas del servidor como líneas del ticket en pantalla, con el producto completo (precio,
 * nombre). Un producto que ya no está en el catálogo cargado se omite: no hay con qué mostrarlo.
 * Conserva el orden del servidor.
 */
export function linesToCart<P extends { product_id: string }>(
  lines: TicketLine[],
  products: P[],
): { product: P; quantity: number }[] {
  const byId = new Map(products.map(p => [p.product_id, p]));
  const cart: { product: P; quantity: number }[] = [];
  for (const line of lines) {
    const product = byId.get(line.product_id);
    if (product) cart.push({ product, quantity: line.quantity });
  }
  return cart;
}

/** ¿Las dos listas dicen lo mismo, sin importar el orden? */
export function sameLines(a: TicketLine[], b: TicketLine[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Map(a.map(l => [l.product_id, l.quantity]));
  return b.every(l => left.get(l.product_id) === l.quantity);
}

/**
 * Parámetros de la consulta periódica: con ellos el servidor contesta 204 (sin cuerpo) si la
 * pantalla ya tiene lo último. La primera vez no hay nada que comparar.
 */
export function pollParams(current: TicketState | null): { since: number; uid: string } | null {
  return current ? { since: current.rev, uid: current.uid } : null;
}

/**
 * Orden de las respuestas. Cada petición recibe un número al salir; una respuesta solo vale si
 * salió DESPUÉS de la última que ya se aplicó. Así una consulta lenta, que salió antes de un
 * cambio propio, no regresa el ticket a un estado viejo cuando por fin llega.
 */
export class ResponseOrder {
  private issued = 0;
  private applied = 0;

  /** Número de una petición que sale ahora. */
  next(): number {
    return ++this.issued;
  }

  /** ¿Puede aplicarse la respuesta de la petición `n`? */
  accepts(n: number): boolean {
    return n > this.applied;
  }

  markApplied(n: number): void {
    if (n > this.applied) this.applied = n;
  }
}
