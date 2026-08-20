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

/** Máximo de productos con color propio; el resto se pliega en "Otros". */
const TOP_PRODUCTS = 6;

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
  const H = 190;
  const padL = 52;
  const padR = 8;
  const padT = 12;
  const padB = 26;

  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const max = Math.max(...buckets.map(b => b.value), 1);
  const niceMax = niceCeil(max);

  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(slot - 2, 34)); // 2px de aire entre columnas

  // Tres líneas de retícula, discretas: la referencia sin robar atención.
  const grid = [0, 0.5, 1]
    .map(t => {
      const y = padT + plotH - t * plotH;
      return `<line x1="${padL}" y1="${y.toFixed(1)}" x2="${W - padR}" y2="${y.toFixed(1)}"
                stroke="${t === 0 ? BASELINE : GRIDLINE}" stroke-width="1"/>
              <text x="${padL - 7}" y="${(y + 3).toFixed(1)}" text-anchor="end"
                font-size="8.5" fill="${INK_MUTED}">${compactMoney(t * niceMax)}</text>`;
    })
    .join('');

  // Con muchas columnas se rota la etiqueta y se muestra una de cada N,
  // para que el eje no se convierta en una mancha ilegible.
  const step = Math.ceil(buckets.length / 16);

  const bars = buckets
    .map((b, i) => {
      const h = niceMax > 0 ? (b.value / niceMax) * plotH : 0;
      const x = padL + i * slot + (slot - barW) / 2;
      const y = padT + plotH - h;
      const label =
        i % step === 0
          ? `<text x="${(x + barW / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle"
               font-size="8" fill="${INK_MUTED}">${esc(b.label)}</text>`
          : '';
      const bar =
        h > 0.5
          ? `<path d="${columnPath(x, y, barW, h, 4)}" fill="${SERIES_BLUE}"/>`
          : '';
      return bar + label;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" width="100%">${grid}${bars}</svg>`;
}

/**
 * Barra apilada horizontal de la composición del ingreso.
 *
 * Es part-to-whole, así que va apilada y no en pastel: comparar ángulos es
 * mucho menos preciso que comparar longitudes sobre una línea común, y con
 * seis categorías la diferencia se nota.
 */
function compositionBar(rows: ProductRow[], total: number): string {
  if (rows.length === 0 || total <= 0) return emptyChart('Sin ventas en el periodo');

  const W = 700;
  const H = 46;
  const barH = 26;

  let x = 0;
  const segments = rows
    .map((r, i) => {
      const w = (r.revenue / total) * W;
      const seg = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0, w - 2).toFixed(2)}"
                     height="${barH}" fill="${hueFor(i, rows.length)}"/>`;
      // Etiqueta dentro del segmento solo si cabe sin recortarse.
      const pct = (r.revenue / total) * 100;
      const inline =
        w > 42
          ? `<text x="${(x + w / 2 - 1).toFixed(2)}" y="${barH / 2 + 3.5}" text-anchor="middle"
               font-size="9.5" font-weight="700" fill="#fff">${pct.toFixed(0)}%</text>`
          : '';
      x += w;
      return seg + inline;
    })
    .join('');

  return `<svg viewBox="0 0 ${W} ${H}" role="img" width="100%">
    <clipPath id="compClip"><rect x="0" y="0" width="${W}" height="${barH}" rx="4"/></clipPath>
    <g clip-path="url(#compClip)">${segments}</g>
  </svg>`;
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
  const barH = 18;
  let x = 0;

  const segments = buckets
    .map(b => {
      const w = (b.value / total) * W;
      const seg = `<rect x="${x.toFixed(2)}" y="0" width="${Math.max(0, w - 2).toFixed(2)}"
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

  const productRows = products
    .slice(0, 12)
    .map(
      p => `<tr>
        <td>${esc(p.name)}</td>
        <td class="num">${p.units}</td>
        <td class="num">${money(p.revenue)}</td>
        <td class="num">${revenueTotal > 0 ? ((p.revenue / revenueTotal) * 100).toFixed(1) : '0.0'}%</td>
      </tr>`
    )
    .join('');

  const saleRows = data.items
    .map(
      sale => `<tr>
        <td class="mono">${esc(sale.order_id)}</td>
        <td class="nowrap">${esc(opts.formatDateTime(sale.created_at))}</td>
        <td>
          <div>${esc(sale.customer_name)}</div>
          <div class="muted">${esc(sale.customer_email)}</div>
        </td>
        <td><span class="badge badge-${esc(sale.status)}">${esc(opts.statusLabel(sale.status))}</span></td>
        <td class="num">${sale.item_count}</td>
        <td class="num">${money(sale.total)}</td>
      </tr>`
    )
    .join('');

  const truncated = data.total > data.items.length;

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de ventas — ${esc(data.business_name)}</title>
<style>
  @page { size: A4; margin: 13mm 11mm 14mm; }
  * { box-sizing: border-box; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: ${INK}; margin: 0; font-size: 10.5px; line-height: 1.45;
    background: #fff;
  }

  /* Encabezado */
  header { display: flex; align-items: center; gap: 13px;
           border-bottom: 2px solid ${SERIES_BLUE}; padding-bottom: 11px; }
  .logo { width: 50px; height: 50px; object-fit: contain; border-radius: 8px; }
  .logo-fallback { width: 50px; height: 50px; border-radius: 8px; background: ${SERIES_BLUE};
                   color: #fff; font-size: 25px; font-weight: 700;
                   display: flex; align-items: center; justify-content: center; }
  .head-main { flex: 1; }
  .biz { font-size: 17px; font-weight: 700; letter-spacing: -.01em; }
  .doc-title { font-size: 11px; color: ${INK_SECONDARY}; font-weight: 600;
               letter-spacing: .05em; text-transform: uppercase; margin-top: 1px; }
  .head-meta { text-align: right; font-size: 9px; color: ${INK_MUTED}; line-height: 1.6; }
  .head-meta strong { color: ${INK_SECONDARY}; }

  .criteria { font-size: 9.5px; color: ${INK_SECONDARY}; padding: 7px 0 0; }
  .criteria b { color: ${INK}; }

  /* Cifra principal + KPIs */
  .hero-row { display: flex; gap: 14px; align-items: stretch; margin: 14px 0 4px; }
  .hero { flex: 0 0 34%; border: 1px solid ${GRIDLINE}; border-radius: 8px; padding: 12px 14px; }
  .hero-label { font-size: 9px; text-transform: uppercase; letter-spacing: .06em; color: ${INK_MUTED}; }
  .hero-value { font-size: 30px; font-weight: 700; letter-spacing: -.02em; margin-top: 3px; }
  .hero-sub { font-size: 9.5px; color: ${INK_SECONDARY}; margin-top: 3px; }
  .kpis { flex: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .kpi { border: 1px solid ${GRIDLINE}; border-radius: 8px; padding: 8px 11px; }
  .kpi-label { font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em; color: ${INK_MUTED}; }
  .kpi-value { font-size: 15px; font-weight: 700; margin-top: 2px; }

  /* Bloques de gráfica */
  .block { margin-top: 15px; page-break-inside: avoid; }
  .block-title { font-size: 11px; font-weight: 700; margin-bottom: 2px; }
  .block-note { font-size: 9px; color: ${INK_MUTED}; margin-bottom: 7px; }
  .chart-empty { border: 1px dashed ${GRIDLINE}; border-radius: 8px; padding: 26px;
                 text-align: center; color: ${INK_MUTED}; font-size: 10px; }

  .legend { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px 18px; margin-top: 9px; }
  .legend-inline { grid-template-columns: repeat(4, 1fr); }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 9.5px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; flex: 0 0 auto; }
  .legend-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .legend-value { color: ${INK_SECONDARY}; font-variant-numeric: tabular-nums; white-space: nowrap; }

  /* Tablas */
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .05em;
       color: ${INK_MUTED}; border-bottom: 1.5px solid ${BASELINE}; padding: 6px 5px; }
  td { padding: 6px 5px; border-bottom: 1px solid #f0f0ec; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .nowrap { white-space: nowrap; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 9px; color: ${INK_SECONDARY}; }
  .muted { color: ${INK_MUTED}; font-size: 9px; }

  .badge { display: inline-block; padding: 2px 6px; border-radius: 20px;
           font-size: 8.5px; font-weight: 600; }
  .badge-paid { background: #dcfce7; color: #14532d; }
  .badge-fulfilled { background: #dbeafe; color: #14306b; }
  .badge-pending { background: #fef3c7; color: #713f12; }
  .badge-canceled { background: #fee2e2; color: #7f1d1d; }

  .page-break { page-break-before: always; }
  .section-head { font-size: 12px; font-weight: 700; margin: 0 0 3px; }
  .warn { font-size: 9px; color: #7f1d1d; background: #fee2e2;
          border-radius: 5px; padding: 5px 8px; margin-bottom: 8px; }

  footer { margin-top: 14px; border-top: 1px solid ${GRIDLINE}; padding-top: 7px;
           font-size: 8.5px; color: ${INK_MUTED}; display: flex; justify-content: space-between; }

  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>

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

  <div class="hero-row">
    <div class="hero">
      <div class="hero-label">Ingreso del periodo</div>
      <div class="hero-value">${money(s.revenue)}</div>
      <div class="hero-sub">Excluye ${s.canceled_count} pedido(s) cancelado(s)</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-label">Pedidos</div><div class="kpi-value">${s.order_count}</div></div>
      <div class="kpi"><div class="kpi-label">Artículos vendidos</div><div class="kpi-value">${s.units}</div></div>
      <div class="kpi"><div class="kpi-label">Ticket promedio</div><div class="kpi-value">${money(avg)}</div></div>
      <div class="kpi"><div class="kpi-label">Productos distintos</div><div class="kpi-value">${products.length}</div></div>
    </div>
  </div>

  <div class="block">
    <div class="block-title">Ingreso por ${grouping}</div>
    <div class="block-note">Evolución del ingreso en el periodo filtrado. Los cancelados no suman.</div>
    ${columnChart(buckets)}
  </div>

  <div class="block">
    <div class="block-title">Composición del ingreso</div>
    <div class="block-note">Peso de cada producto sobre el ingreso total del periodo.</div>
    ${compositionBar(composition, revenueTotal)}
    <div class="legend">${compositionLegend(composition, revenueTotal)}</div>
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

  <div class="block">
    <div class="block-title">Productos más vendidos</div>
    <div class="block-note">Ordenados por ingreso. Máximo doce.</div>
    <table>
      <thead>
        <tr><th>Producto</th><th class="num">Unidades</th><th class="num">Ingreso</th><th class="num">% del total</th></tr>
      </thead>
      <tbody>${productRows || `<tr><td colspan="4" class="muted">Sin productos vendidos en el periodo.</td></tr>`}</tbody>
    </table>
  </div>

  <footer>
    <span>Generado por KARD · Documento interno</span>
    <span>${esc(data.business_name || '')}</span>
  </footer>

  <div class="page-break"></div>

  <h2 class="section-head">Detalle de ventas</h2>
  <div class="block-note">${esc(opts.criteria)}</div>
  ${
    truncated
      ? `<div class="warn">El reporte incluye ${data.items.length} de ${data.total} ventas
         (tope de ${opts.maxRows} filas). Acota el rango de fechas para incluir todo el periodo.</div>`
      : ''
  }
  <table>
    <thead>
      <tr>
        <th>Folio</th><th>Fecha</th><th>Cliente</th>
        <th>Estado</th><th class="num">Artículos</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${saleRows || `<tr><td colspan="6" class="muted">Sin ventas para los filtros seleccionados.</td></tr>`}</tbody>
    <tfoot>
      <tr>
        <th colspan="4" style="text-align:left">Total del periodo (excluye cancelados)</th>
        <th class="num">${s.units}</th>
        <th class="num">${money(s.revenue)}</th>
      </tr>
    </tfoot>
  </table>

  <footer>
    <span>Generado por KARD · Documento interno</span>
    <span>${esc(data.business_name || '')}</span>
  </footer>

</body>
</html>`;
}
