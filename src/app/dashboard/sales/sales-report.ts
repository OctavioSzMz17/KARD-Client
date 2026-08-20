/**
 * Generación del reporte de ventas imprimible.
 *
 * Produce un documento HTML autocontenido (estilos y gráficas SVG en línea)
 * que se abre en ventana nueva y se manda a la impresora, donde el usuario
 * elige "Guardar como PDF". No usa ninguna librería: nada de esto llega al
 * bundle de la aplicación salvo este archivo.
 *
 * La primera hoja es un tablero ejecutivo — KPIs y tres gráficas — y el
 * detalle transaccional queda relegado a las hojas siguientes. Un reporte
 * que abre con doscientas filas no se lee; uno que abre con la composición
 * del ingreso, sí.
 */

import { Sale, SalesReport } from '../../core/services/sales.service';

// ── Paleta ────────────────────────────────────────────────────────────
// Slots categóricos validados (checks de banda de luminosidad, croma,
// separación bajo daltonismo y visión normal). El WARN de contraste de tres
// de estos slots contra papel blanco se compensa con la regla de relieve:
// cada serie lleva etiqueta visible y además existe la tabla de productos.
const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'];
const OTHER_HUE = '#898781';

// Tinta y cromo del documento.
const INK = '#0b0b0b';
const INK_SECONDARY = '#52514e';
const INK_MUTED = '#898781';
const GRIDLINE = '#e1e0d9';
const BASELINE = '#c3c2b7';
const SERIES_BLUE = '#2a78d6';

// Estados: paleta reservada, nunca reutilizada como color de serie.
const STATUS_HUES: Record<string, string> = {
  pending: '#fab219',    // warning
  paid: '#0ca30c',       // good
  fulfilled: '#2a78d6',  // series blue
  canceled: '#d03b3b',   // critical
};

/**
 * Máximo de productos con color propio; el resto se pliega en "Otros".
 * Cinco más "Otros" son seis porciones: suficiente para ver el reparto sin
 * que la dona se vuelva un abanico de rebanadas indistinguibles.
 */
const TOP_PRODUCTS = 5;

/** Pasado este número de días, el eje temporal se agrupa por mes. */
const MAX_DAY_BUCKETS = 45;

export interface ReportOptions {
  logoUrl: string | null;
  /** Descripción legible de los filtros aplicados. */
  criteria: string;
  statusLabel: (status: string) => string;
  formatDateTime: (iso: string) => string;
  /** Tope de filas que trajo el export, para avisar si se recortó. */
  maxRows: number;
}

interface Bucket {
  label: string;
  value: number;
}

interface ProductRow {
  name: string;
  units: number;
  revenue: number;
}

// ── Agregaciones ──────────────────────────────────────────────────────
// Todas excluyen los cancelados, igual que el resumen del backend: un
// pedido cancelado no es ingreso y mezclarlo falsearía cada gráfica.

function activeSales(items: Sale[]): Sale[] {
  return items.filter(s => s.status !== 'canceled');
}

function byProduct(items: Sale[]): ProductRow[] {
  const acc = new Map<string, ProductRow>();

  for (const sale of activeSales(items)) {
    for (const item of sale.items ?? []) {
      const row = acc.get(item.product_name) ?? {
        name: item.product_name,
        units: 0,
        revenue: 0,
      };
      row.units += item.quantity;
      row.revenue += Number(item.subtotal) || 0;
      acc.set(item.product_name, row);
    }
  }

  return [...acc.values()].sort((a, b) => b.revenue - a.revenue);
}

function byStatus(items: Sale[]): Bucket[] {
  const acc = new Map<string, number>();
  for (const sale of items) {
    acc.set(sale.status, (acc.get(sale.status) ?? 0) + 1);
  }
  // Orden fijo: el color sigue al estado, no a su frecuencia.
  return ['pending', 'paid', 'fulfilled', 'canceled']
    .filter(s => acc.has(s))
    .map(s => ({ label: s, value: acc.get(s)! }));
}

/** Serie temporal del ingreso: por día, o por mes si el rango es largo. */
function overTime(items: Sale[]): { buckets: Bucket[]; grouping: 'día' | 'mes' } {
  const sales = activeSales(items);
  if (sales.length === 0) return { buckets: [], grouping: 'día' };

  const dates = sales.map(s => new Date(s.created_at)).filter(d => !isNaN(d.getTime()));
  if (dates.length === 0) return { buckets: [], grouping: 'día' };

  const min = new Date(Math.min(...dates.map(d => d.getTime())));
  const max = new Date(Math.max(...dates.map(d => d.getTime())));
  const spanDays = Math.round((max.getTime() - min.getTime()) / 86_400_000) + 1;
  const byMonth = spanDays > MAX_DAY_BUCKETS;

  const key = (d: Date) =>
    byMonth
      ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
      : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  const acc = new Map<string, number>();
  for (const sale of sales) {
    const d = new Date(sale.created_at);
    if (isNaN(d.getTime())) continue;
    acc.set(key(d), (acc.get(key(d)) ?? 0) + (Number(sale.total) || 0));
  }

  // Los huecos se rellenan con cero: un día sin ventas es información, y
  // omitirlo comprimiría el eje y falsearía la forma de la tendencia.
  const buckets: Bucket[] = [];
  const cursor = new Date(min);
  if (byMonth) cursor.setDate(1);
  cursor.setHours(0, 0, 0, 0);

  while (cursor <= max) {
    const k = key(cursor);
    buckets.push({
      label: byMonth
        ? `${MONTHS_SHORT[cursor.getMonth()]} ${String(cursor.getFullYear()).slice(2)}`
        : `${cursor.getDate()}/${cursor.getMonth() + 1}`,
      value: acc.get(k) ?? 0,
    });
    if (byMonth) cursor.setMonth(cursor.getMonth() + 1);
    else cursor.setDate(cursor.getDate() + 1);
  }

  return { buckets, grouping: byMonth ? 'mes' : 'día' };
}

const MONTHS_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

// ── Gráficas (SVG en línea) ───────────────────────────────────────────

/**
 * Columnas del ingreso en el tiempo. Una sola serie, así que un solo tono:
 * la identidad no está en juego, solo la magnitud.
 */
function columnChart(buckets: Bucket[]): string {
  if (buckets.length === 0) return emptyChart('Sin datos en el periodo');

  const W = 700;
  const H = 196;
  const padL = 46;
  const padR = 6;
  const padT = 18;
  const padB = 34;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...buckets.map(b => b.value), 1);
  const niceMax = niceCeil(max);

  const slot = plotW / buckets.length;
  // Columnas finas con aire generoso: la barra gruesa pega el bloque y
  // convierte la serie en una mancha.
  const barW = Math.max(2, Math.min(slot - 7, 17));

  // Retícula discreta: referencia sin robar atención. Solo la base lleva
  // un tono algo más firme, porque es el cero.
  const grid = [0, 0.5, 1]
    .map(t => {
      const y = padT + plotH - t * plotH;
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"
                stroke="${t === 0 ? BASELINE : GRIDLINE}" stroke-width="${t === 0 ? 1 : 0.75}"/>
              <text x="${padL - 10}" y="${(y + 3).toFixed(1)}" text-anchor="end"
                font-size="8" fill="${INK_MUTED}"
                letter-spacing=".02em">${compactMoney(t * niceMax)}</text>`;
    })
    .join('');

  // Con muchas columnas se muestra una etiqueta de cada N, para que el eje
  // no se convierta en una mancha ilegible.
  const step = Math.ceil(buckets.length / 13);

  const bars = buckets
    .map((b, i) => {
      const h = niceMax > 0 ? (b.value / niceMax) * plotH : 0;
      const x = padL + i * slot + (slot - barW) / 2;
      const y = padT + plotH - h;
      const label =
        i % step === 0
          ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 12}" text-anchor="middle"
               font-size="8" fill="${INK_MUTED}">${esc(b.label)}</text>`
          : '';
      const bar =
        h > 0.5
          ? `<path d="${columnPath(x, y, barW, h, 3)}" fill="${SERIES_BLUE}"/>`
          : '';
      return bar + label;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" width="100%">${grid}${bars}</svg>`;
}

/**
 * Dona de la composición del ingreso.
 *
 * Se deja hueco el centro para alojar el total: refuerza que lo que se está
 * repartiendo es esa cifra. Las porciones se separan con un hueco angular en
 * vez de contornos, y cada una lleva su porcentaje encima cuando cabe; la
 * leyenda de al lado repite nombre e importe, así que la identidad nunca
 * depende del color solo.
 */
function donutChart(rows: ProductRow[], total: number): string {
  if (rows.length === 0 || total <= 0) return emptyChart('Sin ventas en el periodo');

  const SIZE = 260;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const R = 112;
  const r = 68;

  // Hueco angular equivalente a ~2px de superficie sobre el radio exterior.
  const GAP = 2 / R;
  const TAU = Math.PI * 2;

  let angle = -Math.PI / 2; // arranca arriba

  const slices = rows
    .map((row, i) => {
      const share = row.revenue / total;
      const sweep = share * TAU;
      const a0 = angle + GAP / 2;
      const a1 = angle + sweep - GAP / 2;
      angle += sweep;

      // Una porción más chica que el hueco no se puede dibujar sin invertirse.
      if (a1 <= a0) return '';

      const path = `<path d="${donutSlicePath(cx, cy, R, r, a0, a1)}"
                      fill="${hueFor(i, rows.length)}"/>`;

      // El porcentaje va dentro solo si la porción da para leerlo.
      const mid = (a0 + a1) / 2;
      const lr = (R + r) / 2;
      const label =
        share >= 0.07
          ? `<text x="${(cx + lr * Math.cos(mid)).toFixed(1)}"
                   y="${(cy + lr * Math.sin(mid) + 3.5).toFixed(1)}"
                   text-anchor="middle" font-size="11" font-weight="600"
                   fill="#fff">${Math.round(share * 100)}%</text>`
          : '';

      return path + label;
    })
    .join('');

  return `<svg viewBox="0 0 ${SIZE} ${SIZE}" role="img" width="100%">
    ${slices}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="21" font-weight="600"
      letter-spacing="-.02em" fill="${INK}">${compactMoney(total)}</text>
    <text x="${cx}" y="${cy + 15}" text-anchor="middle" font-size="8.5"
      letter-spacing=".1em" fill="${INK_MUTED}">INGRESO</text>
  </svg>`;
}

/** Porción de dona: arco exterior, corte al interior, arco interior de vuelta. */
function donutSlicePath(
  cx: number, cy: number, R: number, r: number, a0: number, a1: number
): string {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const p = (rad: number, a: number) =>
    `${(cx + rad * Math.cos(a)).toFixed(2)},${(cy + rad * Math.sin(a)).toFixed(2)}`;

  return [
    `M${p(R, a0)}`,
    `A${R},${R} 0 ${large} 1 ${p(R, a1)}`,
    `L${p(r, a1)}`,
    `A${r},${r} 0 ${large} 0 ${p(r, a0)}`,
    'Z',
  ].join(' ');
}

/** Leyenda de la composición: color, nombre y monto — nunca color a secas. */
function compositionLegend(rows: ProductRow[], total: number): string {
  return rows
    .map(
      (r, i) => `
      <div class="legend-item">
        <span class="swatch" style="background:${hueFor(i, rows.length)}"></span>
        <span class="legend-name">${esc(r.name)}</span>
        <span class="legend-value">${money(r.revenue)} · ${((r.revenue / total) * 100).toFixed(1)}%</span>
      </div>`
    )
    .join('');
}

/** Reparto de pedidos por estado. Usa la paleta de estado, no la de series. */
function statusBar(buckets: Bucket[], statusLabel: (s: string) => string): string {
  const total = buckets.reduce((sum, b) => sum + b.value, 0);
  if (total === 0) return '';

  const W = 700;
  const barH = 24;
  let x = 0;

  const segments = buckets
    .map(b => {
      const w = (b.value / total) * W;
      const seg = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0, w - 3).toFixed(2)}"
                     height="${barH}" fill="${STATUS_HUES[b.label] ?? OTHER_HUE}"/>`;
      x += w;
      return seg;
    })
    .join('');

  const legend = buckets
    .map(
      b => `<div class="legend-item">
              <span class="swatch" style="background:${STATUS_HUES[b.label] ?? OTHER_HUE}"></span>
              <span class="legend-name">${esc(statusLabel(b.label))}</span>
              <span class="legend-value">${b.value}</span>
            </div>`
    )
    .join('');

  return `<svg viewBox="0 0 ${W} ${barH}" role="img" width="100%">
      <clipPath id="stClip"><rect x="0" y="0" width="${W}" height="${barH}" rx="4"/></clipPath>
      <g clip-path="url(#stClip)">${segments}</g>
    </svg>
    <div class="legend legend-inline">${legend}</div>`;
}

function emptyChart(message: string): string {
  return `<div class="chart-empty">${esc(message)}</div>`;
}

// ── Geometría ─────────────────────────────────────────────────────────

/** Columna con las esquinas superiores redondeadas y la base anclada. */
function columnPath(x: number, y: number, w: number, h: number, r: number): string {
  const rad = Math.min(r, w / 2, h);
  return [
    `M${x.toFixed(2)},${(y + h).toFixed(2)}`,
    `L${x.toFixed(2)},${(y + rad).toFixed(2)}`,
    `Q${x.toFixed(2)},${y.toFixed(2)} ${(x + rad).toFixed(2)},${y.toFixed(2)}`,
    `L${(x + w - rad).toFixed(2)},${y.toFixed(2)}`,
    `Q${(x + w).toFixed(2)},${y.toFixed(2)} ${(x + w).toFixed(2)},${(y + rad).toFixed(2)}`,
    `L${(x + w).toFixed(2)},${(y + h).toFixed(2)}`,
    'Z',
  ].join(' ');
}

/** El último slot es "Otros" y va en gris: no compite con las series. */
function hueFor(index: number, count: number): string {
  const isOther = index === count - 1 && count > TOP_PRODUCTS;
  return isOther ? OTHER_HUE : CATEGORICAL[index % CATEGORICAL.length];
}

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(value)));
  return Math.ceil(value / mag) * mag;
}

// ── Formato ───────────────────────────────────────────────────────────

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function money(value: number | string): string {
  const n = Number(value) || 0;
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compactMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`;
  return `$${Math.round(value)}`;
}

function esc(value: string): string {
  return (value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Documento ─────────────────────────────────────────────────────────

export function buildSalesReportHtml(data: SalesReport, opts: ReportOptions): string {
  const s = data.summary;
  const validOrders = s.order_count - s.canceled_count;
  const avg = validOrders > 0 ? Number(s.revenue) / validOrders : 0;
  const generated = new Date();

  // Top productos con el resto plegado en "Otros": más de siete franjas
  // dejan de distinguirse y la gráfica pierde el sentido.
  const products = byProduct(data.items);
  const revenueTotal = products.reduce((sum, p) => sum + p.revenue, 0);
  const top = products.slice(0, TOP_PRODUCTS);
  const rest = products.slice(TOP_PRODUCTS);
  const composition: ProductRow[] = rest.length
    ? [
        ...top,
        {
          name: `Otros (${rest.length})`,
          units: rest.reduce((n, p) => n + p.units, 0),
          revenue: rest.reduce((n, p) => n + p.revenue, 0),
        },
      ]
    : top;

  const { buckets, grouping } = overTime(data.items);
  const statuses = byStatus(data.items);

  const logo = opts.logoUrl
    ? `<img class="logo" src="${esc(opts.logoUrl)}" alt="">`
    : `<div class="logo-fallback">${esc((data.business_name || 'K').charAt(0).toUpperCase())}</div>`;

  const truncated = data.total > data.items.length;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de ventas — ${esc(data.business_name)}</title>
<style>
  @page { size: A4; margin: 16mm 15mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: ${INK}; margin: 0; font-size: 10px; line-height: 1.55;
    background: #f0f0ee;
    -webkit-font-smoothing: antialiased;
  }

  /* La hoja. En pantalla se comporta como una hoja sobre la mesa; al
     imprimir se desarma, porque ahí los márgenes los pone @page. */
  .sheet {
    max-width: 860px; margin: 32px auto; background: #fff;
    padding: 48px 54px 40px; box-shadow: 0 1px 3px rgba(0,0,0,.07);
  }
  @media print {
    body { background: #fff; }
    .sheet { max-width: none; margin: 0; padding: 0; box-shadow: none; }
  }

  /* Encabezado — una hairline, no una franja de color */
  header { display: flex; align-items: center; gap: 16px;
           border-bottom: 1px solid ${BASELINE}; padding-bottom: 18px; }
  .logo { width: 44px; height: 44px; object-fit: contain; border-radius: 7px; }
  .logo-fallback { width: 44px; height: 44px; border-radius: 7px; background: ${SERIES_BLUE};
                   color: #fff; font-size: 21px; font-weight: 600;
                   display: flex; align-items: center; justify-content: center; }
  .head-main { flex: 1; }
  .biz { font-size: 19px; font-weight: 600; letter-spacing: -.015em; line-height: 1.2; }
  .doc-title { font-size: 9px; color: ${INK_MUTED}; font-weight: 500;
               letter-spacing: .14em; text-transform: uppercase; margin-top: 5px; }
  .head-meta { text-align: right; font-size: 8.5px; color: ${INK_MUTED}; line-height: 1.75; }
  .head-meta strong { color: ${INK_SECONDARY}; font-weight: 500; }

  .criteria { font-size: 9px; color: ${INK_MUTED}; padding: 12px 0 0; letter-spacing: .01em; }
  .criteria b { color: ${INK_SECONDARY}; font-weight: 500; }

  /* Cifra principal + métricas — sin cajas, separadas por hairlines */
  .summary { display: flex; align-items: flex-start; gap: 30px; margin: 30px 0 6px; }
  .hero { flex: 0 0 30%; }
  .hero-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: .12em;
                color: ${INK_MUTED}; }
  .hero-value { font-size: 34px; font-weight: 600; letter-spacing: -.03em;
                line-height: 1.1; margin-top: 8px; }
  .hero-sub { font-size: 9px; color: ${INK_MUTED}; margin-top: 8px; }
  .metrics { flex: 1; display: flex; }
  .metric { flex: 1; padding: 2px 0 2px 20px; border-left: 1px solid ${GRIDLINE}; }
  .metric:first-child { border-left: none; padding-left: 0; }
  .metric-label { display: block; font-size: 8.5px; text-transform: uppercase;
                  letter-spacing: .1em; color: ${INK_MUTED}; }
  .metric-value { display: block; font-size: 19px; font-weight: 600;
                  letter-spacing: -.02em; margin-top: 7px; }

  /* Bloques de gráfica — el aire entre secciones es lo que ordena la hoja.
     Ajustado para que el resumen entre completo en una sola A4. */
  .block { margin-top: 28px; page-break-inside: avoid; }
  .block-title { font-size: 8.5px; font-weight: 600; text-transform: uppercase;
                 letter-spacing: .12em; color: ${INK_SECONDARY}; }
  .block-note { font-size: 9px; color: ${INK_MUTED}; margin-top: 3px; margin-bottom: 18px; }
  .chart-empty { padding: 34px; text-align: center; color: ${INK_MUTED}; font-size: 9.5px;
                 border-top: 1px solid ${GRIDLINE}; border-bottom: 1px solid ${GRIDLINE}; }

  /* Composición: dona a la izquierda, leyenda en columna al costado */
  .composition { display: flex; align-items: center; gap: 44px; }
  .composition-chart { flex: 0 0 204px; }
  .legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 9px 40px; margin-top: 20px; }
  .legend-stack { grid-template-columns: 1fr; gap: 13px; margin-top: 0; flex: 1; }
  .legend-inline { grid-template-columns: repeat(4, 1fr); gap: 9px 24px; }
  /* En la leyenda de estados el valor va pegado a su etiqueta: son pocos
     y separarlos al ancho de la columna los desvincula visualmente. */
  .legend-inline .legend-name { flex: 0 1 auto; }
  .legend-item { display: flex; align-items: baseline; gap: 8px; font-size: 9px; }
  .swatch { width: 7px; height: 7px; border-radius: 2px; flex: 0 0 auto;
            position: relative; top: -1px; }
  .legend-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                 color: ${INK_SECONDARY}; }
  .legend-value { color: ${INK}; font-variant-numeric: tabular-nums; white-space: nowrap;
                  font-weight: 500; }

  .warn { font-size: 9px; color: #7f1d1d; border-left: 2px solid #d03b3b;
          padding: 3px 0 3px 10px; margin-top: 26px; }

  footer { margin-top: 30px; border-top: 1px solid ${GRIDLINE}; padding-top: 10px;
           font-size: 8px; color: ${INK_MUTED}; display: flex;
           justify-content: space-between; letter-spacing: .03em; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
<div class="sheet">

  <header>
    ${logo}
    <div class="head-main">
      <div class="biz">${esc(data.business_name || 'Negocio')}</div>
      <div class="doc-title">Reporte de ventas</div>
    </div>
    <div class="head-meta">
      <div><strong>Emitido</strong> ${esc(opts.formatDateTime(generated.toISOString()))}</div>
      <div>${data.items.length} de ${data.total} registros</div>
      <div><strong>KARD</strong></div>
    </div>
  </header>

  <div class="criteria"><b>Criterios:</b> ${esc(opts.criteria)}</div>

  <div class="summary">
    <div class="hero">
      <div class="hero-label">Ingreso del periodo</div>
      <div class="hero-value">${money(s.revenue)}</div>
      <div class="hero-sub">Excluye ${s.canceled_count} pedido(s) cancelado(s)</div>
    </div>
    <div class="metrics">
      <div class="metric"><span class="metric-label">Pedidos</span><span class="metric-value">${s.order_count}</span></div>
      <div class="metric"><span class="metric-label">Artículos</span><span class="metric-value">${s.units}</span></div>
      <div class="metric"><span class="metric-label">Ticket prom.</span><span class="metric-value">${money(avg)}</span></div>
      <div class="metric"><span class="metric-label">Productos</span><span class="metric-value">${products.length}</span></div>
    </div>
  </div>

  <div class="block">
    <div class="block-title">Composición del ingreso</div>
    <div class="block-note">Peso de cada producto sobre el ingreso total del periodo.</div>
    <div class="composition">
      <div class="composition-chart">${donutChart(composition, revenueTotal)}</div>
      <div class="legend legend-stack">${compositionLegend(composition, revenueTotal)}</div>
    </div>
  </div>

  <div class="block">
    <div class="block-title">Ingreso por ${grouping}</div>
    <div class="block-note">Evolución del ingreso en el periodo. Los cancelados no suman.</div>
    ${columnChart(buckets)}
  </div>

  ${
    statuses.length > 1
      ? `<div class="block">
           <div class="block-title">Pedidos por estado</div>
           <div class="block-note">Reparto de los ${s.order_count} pedidos del periodo.</div>
           ${statusBar(statuses, opts.statusLabel)}
         </div>`
      : ''
  }

  ${
    truncated
      ? `<div class="warn">Las gráficas cubren ${data.items.length} de ${data.total} ventas
         (tope de ${opts.maxRows}). Los totales de arriba sí abarcan el periodo completo.</div>`
      : ''
  }

  <footer>
    <span>Generado por KARD · Documento interno · El desglose venta por venta está en la descarga CSV</span>
    <span>${esc(data.business_name || '')}</span>
  </footer>

</div>
</body>
</html>`;
}
