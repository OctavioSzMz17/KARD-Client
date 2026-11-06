/**
 * Cuentas de las gráficas del Dashboard, sin Angular ni HTTP.
 *
 * Las gráficas se dibujan en un cuadro fijo (viewBox) a partir de los datos REALES del
 * negocio: lo vendido cada día y lo más vendido. Nada se inventa ni cambia al volver a entrar.
 */

const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/** Margen superior para que el día más alto no quede pegado al borde de la gráfica. */
const TOP_PAD = 8;

export interface Point {
  x: number;
  y: number;
}

/**
 * Puntos de una serie dentro de un cuadro de `width` × `height`.
 *
 * El valor más alto queda arriba (con margen) y el cero, abajo. Una serie sin ventas (todo cero)
 * es una línea plana en el piso: es la verdad, no se estira para que "se vea algo".
 */
export function seriesPoints(values: number[], width: number, height: number): Point[] {
  const n = values.length;
  if (n === 0) return [];
  const max = Math.max(...values, 0);
  return values.map((v, i) => ({
    x: n === 1 ? width / 2 : (i / (n - 1)) * width,
    y: max > 0 ? height - (Math.max(v, 0) / max) * (height - TOP_PAD) : height,
  }));
}

/** El trazo de la línea (`M x,y L x,y …`); vacío si no hay datos. */
export function linePath(values: number[], width: number, height: number): string {
  return seriesPoints(values, width, height)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(' ');
}

/** El mismo trazo cerrado hasta el piso, para rellenar el área bajo la línea. */
export function areaPath(values: number[], width: number, height: number): string {
  const line = linePath(values, width, height);
  return line ? `${line} L${width},${height} L0,${height} Z` : '';
}

/**
 * Etiquetas de los días: el nombre abreviado, y "Hoy" para el último.
 *
 * El día de la semana sale de la fecha tal como viene del servidor (la del negocio), construida
 * con sus partes: pasarla por `new Date('2026-11-03')` la leería como UTC y en México caería
 * el día anterior.
 */
export function dayLabels(isoDates: string[]): string[] {
  return isoDates.map((iso, i) => {
    if (i === isoDates.length - 1) return 'Hoy';
    const [y, m, d] = iso.split('-').map(Number);
    return WEEKDAYS[new Date(y, m - 1, d).getDay()];
  });
}

/** Ancho de una barra, de 0 a 100, respecto al mayor. Una barra con algo nunca desaparece. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(6, Math.round((value / max) * 100));
}
