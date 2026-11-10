/**
 * Reglas del tablero de órdenes: los pedidos que hacen los clientes desde la tienda.
 *
 * Un pedido tiene dos ejes independientes: el pago (`status`) y la entrega (`fulfillment_status`).
 * El tablero ubica cada pedido en una sola columna según su entrega, y deja el pago como una marca.
 * Todo lo que no toca la pantalla vive aquí para poder probarlo.
 */

export type BoardState = 'preparing' | 'ready' | 'in_transit' | 'completed' | 'canceled';

/** Las columnas, en el orden en que avanza un pedido. */
export const BOARD_STATES: readonly BoardState[] = ['preparing', 'ready', 'in_transit', 'completed', 'canceled'];

export interface ShippingAddress {
  street: string;
  neighborhood?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  notes?: string | null;
}

/** Un pedido del tablero (la venta tal como la devuelve el servidor). */
export interface BoardSale {
  order_id: string;
  /** Pago: `pending` (sin cobrar), `paid`, `refunded`, `fulfilled` (histórico: ya entregado) o `canceled`. */
  status: string;
  fulfillment_type: string;
  fulfillment_status: string;
  total: string;
  item_count: number;
  customer_name: string;
  customer_email?: string | null;
  table_number?: string | null;
  shipping_address?: ShippingAddress | null;
  payment_method?: string | null;
  items: { product_name: string; quantity: number }[];
  created_at: string;
}

export interface OrdersQueue {
  items: BoardSale[];
  counts: Partial<Record<BoardState, number>>;
  /** Pedidos en marcha que todavía no se cobran. */
  awaiting_payment: number;
}

/** Lo que se le pide al servidor al mover un pedido. */
export interface OrderPatch {
  status?: 'pending' | 'paid' | 'canceled';
  fulfillment_status?: BoardState;
}

/** En qué columna cae un pedido. Lo cancelado gana; `fulfilled` (valor viejo del pago) cuenta como entregado. */
export function boardState(sale: Pick<BoardSale, 'status' | 'fulfillment_status'>): BoardState {
  if (sale.status === 'canceled' || sale.fulfillment_status === 'canceled') return 'canceled';
  if (sale.status === 'fulfilled') return 'completed';
  const state = sale.fulfillment_status as BoardState;
  return BOARD_STATES.includes(state) ? state : 'preparing';
}

/** Los pedidos repartidos por columna, cada una con el más antiguo primero (al que le toca atenderse). */
export function groupByState(sales: readonly BoardSale[]): Record<BoardState, BoardSale[]> {
  const columns: Record<BoardState, BoardSale[]> = {
    preparing: [], ready: [], in_transit: [], completed: [], canceled: [],
  };
  for (const sale of sales) columns[boardState(sale)].push(sale);
  const oldestFirst = (a: BoardSale, b: BoardSale) => Date.parse(a.created_at) - Date.parse(b.created_at);
  columns.preparing.sort(oldestFirst);
  columns.ready.sort(oldestFirst);
  columns.in_transit.sort(oldestFirst);
  // Lo ya cerrado se lee al revés: lo último que pasó, arriba.
  columns.completed.sort((a, b) => oldestFirst(b, a));
  columns.canceled.sort((a, b) => oldestFirst(b, a));
  return columns;
}

export const STATE_LABELS: Record<BoardState, string> = {
  preparing: 'Nuevas',
  ready: 'Listas',
  in_transit: 'En camino',
  completed: 'Entregadas',
  canceled: 'Canceladas',
};

/** El siguiente paso de un pedido: el botón principal de su tarjeta. `null` si ya está cerrado. */
export function nextStep(sale: BoardSale): { label: string; patch: OrderPatch } | null {
  switch (boardState(sale)) {
    case 'preparing':
      return { label: 'Marcar lista', patch: { fulfillment_status: 'ready' } };
    case 'ready':
      // A domicilio sale primero a la calle; lo demás se entrega en mano.
      return sale.fulfillment_type === 'delivery'
        ? { label: 'Salió a domicilio', patch: { fulfillment_status: 'in_transit' } }
        : { label: handoverLabel(sale), patch: { fulfillment_status: 'completed' } };
    case 'in_transit':
      return { label: 'Entregada', patch: { fulfillment_status: 'completed' } };
    default:
      return null;
  }
}

function handoverLabel(sale: BoardSale): string {
  return sale.fulfillment_type === 'dine_in' ? 'Servida' : 'Entregada';
}

/** `true` si el pedido está en marcha (ni entregado ni cancelado). */
export function isActive(sale: BoardSale): boolean {
  const state = boardState(sale);
  return state !== 'completed' && state !== 'canceled';
}

/** El pedido sigue en marcha y no se ha cobrado. */
export function needsPayment(sale: BoardSale): boolean {
  return isActive(sale) && sale.status === 'pending';
}

export function modeLabel(sale: Pick<BoardSale, 'fulfillment_type' | 'table_number'>): string {
  switch (sale.fulfillment_type) {
    case 'dine_in':  return sale.table_number ? `En mesa ${sale.table_number}` : 'En el local';
    case 'takeaway': return 'Para llevar';
    case 'pickup':   return 'Pasa a recoger';
    case 'delivery': return 'A domicilio';
    default:         return sale.fulfillment_type;
  }
}

export const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Efectivo', card: 'Tarjeta', transfer: 'Transferencia', online: 'En línea',
};

/** "hace 5 min", "hace 2 h", "hace 3 días". */
export function waitLabel(createdAt: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 60000));
  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return `hace ${days} ${days === 1 ? 'día' : 'días'}`;
}

/** Minutos que un pedido nuevo puede esperar antes de marcarse como tardado. */
export const LATE_AFTER_MINUTES = 20;

/** Un pedido nuevo que lleva demasiado esperando. Solo aplica a los que siguen sin atenderse. */
export function isLate(sale: BoardSale, now: number = Date.now()): boolean {
  return boardState(sale) === 'preparing' && (now - Date.parse(sale.created_at)) / 60000 >= LATE_AFTER_MINUTES;
}

/** El folio corto que se dice en voz alta: los últimos caracteres del identificador. */
export function shortFolio(orderId: string): string {
  return orderId.replace(/^ord_/, '').slice(-5).toUpperCase();
}

/** La dirección de entrega en líneas, sin las partes vacías. */
export function addressLines(address: ShippingAddress | null | undefined): string[] {
  if (!address) return [];
  const place = [address.neighborhood, address.city, address.state].filter(Boolean).join(', ');
  const zip = address.postal_code ? `C.P. ${address.postal_code}` : '';
  return [address.street, [place, zip].filter(Boolean).join(' · ')].filter(Boolean);
}

/**
 * Los pedidos nuevos que aparecieron desde la última vez, para avisar. La primera carga no avisa
 * de nada (`seen` es `null`): no son "nuevos", solo es lo que ya había.
 */
export function newOrders(seen: ReadonlySet<string> | null, sales: readonly BoardSale[]): BoardSale[] {
  if (seen === null) return [];
  return sales.filter(s => boardState(s) === 'preparing' && !seen.has(s.order_id));
}
