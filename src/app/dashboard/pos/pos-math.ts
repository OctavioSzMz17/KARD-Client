/**
 * Matemática del cobro en mostrador. Espejo de `orders/money.py` del backend:
 * la pantalla muestra lo mismo que el servidor va a cobrar.
 *
 * Todo se calcula en CENTAVOS enteros. Con decimales de punto flotante,
 * 0.1 + 0.2 ≠ 0.3 y un total puede salir un centavo corrido; con enteros la
 * suma es exacta y el redondeo ocurre una sola vez, en el único lugar donde
 * hace falta (el porcentaje de descuento).
 *
 * Reglas, en el orden en que se aplican:
 *   1. El descuento resta del subtotal y no puede pasar de él.
 *   2. La propina se suma al final.
 *   3. El cambio es lo recibido menos el total; recibir de menos es un error.
 */

export type DiscountKind = 'percent' | 'amount';

export interface DiscountInput {
  kind: DiscountKind;
  /** Lo que escribió el cajero: "10" (%) o "50.00" ($). */
  value: string;
}

export interface CartLine {
  /** Precio unitario en pesos, como lo manda la API ("38.00"). */
  price: string;
  quantity: number;
}

export interface Totals {
  subtotal: number;   // centavos
  discount: number;
  tip: number;
  total: number;
  /** Mensaje para mostrar al cajero si el descuento o la propina no son válidos. */
  error: string | null;
}

/**
 * Texto de dinero → centavos enteros, o null si no es un importe válido.
 * Acepta "12", "12.5", "12.50", "$1,200.00" y ".5". Más de dos decimales se
 * redondea hacia arriba en el medio, igual que el servidor.
 */
export function toCents(text: string | number | null | undefined): number | null {
  if (text === null || text === undefined) return null;
  const clean = String(text).replace(/[$,\s]/g, '');
  if (clean === '' || !/^\d*\.?\d*$/.test(clean) || clean === '.') return null;

  const [whole = '0', frac = ''] = clean.split('.');
  const wholeCents = Number(whole || '0') * 100;
  const padded = (frac + '00').slice(0, 2);
  let cents = wholeCents + Number(padded);
  if (frac.length > 2 && Number(frac[2]) >= 5) cents += 1;
  return Number.isSafeInteger(cents) ? cents : null;
}

/** Centavos → "$1,234.50". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(Math.round(cents));
  const pesos = Math.floor(abs / 100).toLocaleString('es-MX');
  const rest = String(abs % 100).padStart(2, '0');
  return `${sign}$${pesos}.${rest}`;
}

/** Importe de la API ("1234.5", "-30.00") → "$1,234.50". Con un valor ausente o inválido muestra $0.00. */
export function formatMoney(text: string | number | null | undefined): string {
  const negative = String(text ?? '').trim().startsWith('-');
  const cents = toCents(String(text ?? '').replace('-', '')) ?? 0;
  return formatCents(negative ? -cents : cents);
}

/** Centavos → "1234.50", la forma que acepta la API en sus campos de dinero. */
export function centsToApi(cents: number): string {
  const abs = Math.abs(cents);
  return `${cents < 0 ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

export function subtotalOf(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + (toCents(l.price) ?? 0) * l.quantity, 0);
}

/** Cuánto se descuenta, en centavos. Lanza un Error con mensaje para el cajero si no es válido. */
export function discountCents(subtotal: number, discount: DiscountInput | null): number {
  if (!discount || discount.value.trim() === '') return 0;

  if (discount.kind === 'percent') {
    const hundredths = toCents(discount.value);   // "12.5" → 1250 (centésimas de porcentaje)
    if (hundredths === null || hundredths <= 0 || hundredths > 10_000) {
      throw new Error('El porcentaje debe estar entre 0 y 100');
    }
    // subtotal × (hundredths / 100) / 100, redondeado a centavo hacia arriba en el medio.
    return Math.floor((subtotal * hundredths + 5_000) / 10_000);
  }

  const amount = toCents(discount.value);
  if (amount === null || amount <= 0) throw new Error('Escribe un monto de descuento válido');
  if (amount > subtotal) {
    throw new Error(`El descuento (${formatCents(amount)}) no puede ser mayor que el subtotal (${formatCents(subtotal)})`);
  }
  return amount;
}

/** Subtotal, descuento, propina y total del carrito. Nunca lanza: los errores van en `error`. */
export function computeTotals(
  lines: CartLine[],
  discount: DiscountInput | null,
  tipText: string,
): Totals {
  const subtotal = subtotalOf(lines);
  let discountValue = 0;
  let error: string | null = null;

  try {
    discountValue = discountCents(subtotal, discount);
  } catch (e) {
    error = (e as Error).message;
  }

  let tip = 0;
  if (tipText.trim() !== '') {
    const parsed = toCents(tipText);
    if (parsed === null) error ??= 'La propina no es un importe válido';
    else tip = parsed;
  }

  return { subtotal, discount: discountValue, tip, total: subtotal - discountValue + tip, error };
}

export interface ChangeResult {
  /** Cambio a devolver (0 si pagó exacto o si aún no alcanza). */
  change: number;
  /** Lo que falta si lo recibido no cubre el total. */
  missing: number;
  /** Se puede cobrar: lo recibido cubre el total. */
  enough: boolean;
}

export function changeFor(total: number, receivedText: string): ChangeResult {
  const received = toCents(receivedText);
  if (received === null) return { change: 0, missing: total, enough: false };
  if (received < total) return { change: 0, missing: total - received, enough: false };
  return { change: received - total, missing: 0, enough: true };
}

/**
 * Billetes y montos rápidos para "recibido": el total exacto y los billetes
 * mexicanos que lo cubren, sin repetir. Con ellos el cajero toca un botón en
 * vez de teclear.
 */
export function quickAmounts(total: number): number[] {
  if (total <= 0) return [];
  const bills = [20, 50, 100, 200, 500, 1000].map(b => b * 100);
  const options = new Set<number>([total]);
  for (const bill of bills) {
    if (bill >= total) options.add(bill);
  }
  // Si el total supera el billete más grande, ofrece el siguiente múltiplo de 100 y de 500.
  for (const step of [10_000, 50_000]) {
    options.add(Math.ceil(total / step) * step);
  }
  return [...options].filter(n => n >= total && n > 0).sort((a, b) => a - b).slice(0, 4);
}
