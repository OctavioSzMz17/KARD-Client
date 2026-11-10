/**
 * Qué productos llevan existencias y cómo se ven en el panel.
 *
 * En un restaurante el platillo se cocina al momento: no hay "12 chilaquiles guardados". Lo que se
 * acaba son los insumos de su receta. El servidor marca cada producto con `tracks_stock`; aquí se
 * decide qué mostrar con eso. Un producto sin la marca (una respuesta de un servidor más viejo)
 * cuenta como si llevara existencias, que es como se comportaba antes.
 */

/** Lo mínimo de un producto que estas reglas necesitan. */
export interface StockItem {
  inventory_count: number;
  low_stock_threshold: number;
  tracks_stock?: boolean;
  metadata?: Record<string, any>;
}

export type StockLevel = 'ok' | 'low' | 'out';

/** `true` si el producto tiene existencias propias que contar. */
export function tracksStock(p: Pick<StockItem, 'tracks_stock'>): boolean {
  return p.tracks_stock !== false;
}

/** Solo los productos que llevan existencias. */
export function stockTracked<T extends StockItem>(products: readonly T[]): T[] {
  return products.filter(tracksStock);
}

/** Nivel de existencias de un producto que las lleva. */
export function stockLevel(p: StockItem): StockLevel {
  if (p.inventory_count === 0) return 'out';
  if (p.inventory_count < p.low_stock_threshold) return 'low';
  return 'ok';
}

/** Las que están bajas (sin llegar a cero), de lo que lleva existencias. */
export function lowStock<T extends StockItem>(products: readonly T[]): T[] {
  return stockTracked(products).filter(p => stockLevel(p) === 'low');
}

/** Las agotadas, de lo que lleva existencias. */
export function outOfStock<T extends StockItem>(products: readonly T[]): T[] {
  return stockTracked(products).filter(p => stockLevel(p) === 'out');
}

/** Suma de existencias de lo que las lleva. */
export function totalStock(products: readonly StockItem[]): number {
  return stockTracked(products).reduce((sum, p) => sum + p.inventory_count, 0);
}

const CATEGORY_LABELS: Record<string, string> = {
  entrada: 'Entrada',
  plato_fuerte: 'Plato fuerte',
  postre: 'Postre',
  bebida: 'Bebida',
  guarnicion: 'Guarnición',
};

/** La línea de detalle de un producto: sus existencias, o su categoría si es un platillo. */
export function stockDetail(p: StockItem): string {
  if (tracksStock(p)) return `${p.inventory_count} unidades en stock`;
  const category = p.metadata?.['categoria'];
  return CATEGORY_LABELS[category] ?? 'Platillo';
}

/** Color del indicador: el nivel de existencias, o un tono neutro si el producto no las lleva. */
export function stockColor(p: StockItem): string {
  if (!tracksStock(p)) return '#818cf8';
  const level = stockLevel(p);
  return level === 'out' ? '#f87171' : level === 'low' ? '#fbbf24' : '#34d399';
}
