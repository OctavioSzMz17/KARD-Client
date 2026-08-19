import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { BrandingService } from '../../core/services/branding.service';
import { OrderStatus } from '../../core/services/order.service';
import { Sale, SalesFilters, SalesReport, SalesService } from '../../core/services/sales.service';

/** Tamaño de página de la tabla en pantalla. */
const PAGE_SIZE = 20;

/**
 * Tope de filas que se piden al exportar. El reporte debe traer TODO el
 * conjunto filtrado, no la página visible; este techo evita que un filtro
 * demasiado abierto tumbe el navegador.
 */
const EXPORT_MAX_ROWS = 2000;

interface StatusOption {
  value: OrderStatus | '';
  label: string;
}

@Component({
  selector: 'app-sales',
  imports: [FormsModule, DecimalPipe],
  templateUrl: './sales.component.html',
  styleUrl: './sales.component.scss',
})
export class SalesComponent implements OnInit {
  private salesService = inject(SalesService);
  private branding = inject(BrandingService);

  // ── Estado ──────────────────────────────────────────────
  report = signal<SalesReport | null>(null);
  loading = signal(false);
  error = signal<string | null>(null);
  exporting = signal(false);
  page = signal(1);

  // ── Filtros (ngModel) ───────────────────────────────────
  dateFrom = '';
  dateTo = '';
  status: OrderStatus | '' = '';
  search = '';

  /** Mes seleccionado en el atajo ('YYYY-MM'), o '' si se usa rango libre. */
  month = '';

  private logoUrl: string | null = null;

  statusOptions: StatusOption[] = [
    { value: '',          label: 'Todos los estados' },
    { value: 'pending',   label: 'Pendiente' },
    { value: 'paid',      label: 'Pagado' },
    { value: 'fulfilled', label: 'Entregado' },
    { value: 'canceled',  label: 'Cancelado' },
  ];

  sales = computed(() => this.report()?.items ?? []);
  summary = computed(() => this.report()?.summary ?? null);
  totalRows = computed(() => this.report()?.total ?? 0);
  totalPages = computed(() => Math.max(1, Math.ceil(this.totalRows() / PAGE_SIZE)));

  /** Ticket promedio: ingreso entre pedidos que sí cuentan (sin cancelados). */
  averageTicket = computed(() => {
    const s = this.summary();
    if (!s) return 0;
    const validOrders = s.order_count - s.canceled_count;
    return validOrders > 0 ? Number(s.revenue) / validOrders : 0;
  });

  hasActiveFilters = computed(() =>
    !!(this.dateFrom || this.dateTo || this.status || this.search.trim())
  );

  ngOnInit(): void {
    this.load();
    // El logo es solo para el encabezado del reporte; si falla, el reporte
    // sale igual pero sin imagen.
    this.branding.get().subscribe({
      next: b => (this.logoUrl = b.logo_url),
      error: () => (this.logoUrl = null),
    });
  }

  // ── Carga ───────────────────────────────────────────────

  load(): void {
    this.loading.set(true);
    this.error.set(null);

    this.salesService.list(this.currentFilters(this.page(), PAGE_SIZE)).subscribe({
      next: r => {
        this.report.set(r);
        this.loading.set(false);
      },
      error: err => {
        this.error.set(
          err?.error?.error ?? 'No se pudieron cargar las ventas. Intenta de nuevo.'
        );
        this.loading.set(false);
      },
    });
  }

  applyFilters(): void {
    this.page.set(1);
    this.load();
  }

  clearFilters(): void {
    this.dateFrom = '';
    this.dateTo = '';
    this.status = '';
    this.search = '';
    this.month = '';
    this.applyFilters();
  }

  /** Atajo: elegir un mes llena el rango de fechas de ese mes completo. */
  onMonthChange(): void {
    if (!this.month) {
      this.dateFrom = '';
      this.dateTo = '';
    } else {
      const [y, m] = this.month.split('-').map(Number);
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      this.dateFrom = `${this.month}-01`;
      this.dateTo = `${this.month}-${String(lastDay).padStart(2, '0')}`;
    }
    this.applyFilters();
  }

  /** Editar el rango a mano invalida el atajo de mes. */
  onDateRangeChange(): void {
    this.month = '';
    this.applyFilters();
  }

  goToPage(p: number): void {
    if (p < 1 || p > this.totalPages() || p === this.page()) return;
    this.page.set(p);
    this.load();
  }

  private currentFilters(page: number, pageSize: number): SalesFilters {
    return {
      dateFrom: this.dateFrom || null,
      dateTo: this.dateTo || null,
      status: this.status || null,
      search: this.search || null,
      page,
      pageSize,
    };
  }

  // ── Exportación ─────────────────────────────────────────

  /**
   * Trae el conjunto filtrado completo (no la página) para exportar.
   * Devuelve null y deja el error puesto si la petición falla.
   */
  private async fetchAllFiltered(): Promise<SalesReport | null> {
    try {
      return await firstValueFrom(
        this.salesService.list(this.currentFilters(1, EXPORT_MAX_ROWS))
      );
    } catch {
      this.error.set('No se pudo generar el reporte. Intenta de nuevo.');
      return null;
    }
  }

  async downloadCsv(): Promise<void> {
    this.exporting.set(true);
    const data = await this.fetchAllFiltered();
    this.exporting.set(false);
    if (!data) return;

    const header = ['Folio', 'Fecha', 'Cliente', 'Correo', 'Estado', 'Artículos', 'Total'];
    const rows = data.items.map(s => [
      s.order_id,
      this.formatDateTime(s.created_at),
      s.customer_name,
      s.customer_email,
      this.statusLabel(s.status),
      String(s.item_count),
      s.total,
    ]);

    const csv = [header, ...rows]
      .map(cols => cols.map(c => this.csvCell(c)).join(','))
      .join('\r\n');

    // BOM para que Excel abra los acentos correctamente.
    this.triggerDownload(
      new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' }),
      `ventas-${this.fileStamp()}.csv`
    );
  }

  /**
   * Abre el reporte formateado en una ventana nueva y lanza el diálogo de
   * impresión, donde el usuario elige "Guardar como PDF". Evita sumar una
   * dependencia de generación de PDF al bundle.
   */
  async downloadPdf(): Promise<void> {
    this.exporting.set(true);
    const data = await this.fetchAllFiltered();
    this.exporting.set(false);
    if (!data) return;

    const win = window.open('', '_blank');
    if (!win) {
      this.error.set(
        'El navegador bloqueó la ventana del reporte. Permite las ventanas emergentes para este sitio.'
      );
      return;
    }

    win.document.write(this.buildReportHtml(data));
    win.document.close();
    win.focus();
    // Esperamos al logo: si se imprime antes de que cargue, sale en blanco.
    setTimeout(() => win.print(), 400);
  }

  private buildReportHtml(data: SalesReport): string {
    const s = data.summary;
    const validOrders = s.order_count - s.canceled_count;
    const avg = validOrders > 0 ? Number(s.revenue) / validOrders : 0;
    const generated = new Date();

    const logo = this.logoUrl
      ? `<img class="logo" src="${this.escape(this.logoUrl)}" alt="">`
      : `<div class="logo-fallback">${this.escape(
          (data.business_name || 'K').charAt(0).toUpperCase()
        )}</div>`;

    const rows = data.items
      .map(
        sale => `
      <tr>
        <td class="mono">${this.escape(sale.order_id)}</td>
        <td>${this.escape(this.formatDateTime(sale.created_at))}</td>
        <td>
          <div>${this.escape(sale.customer_name)}</div>
          <div class="muted">${this.escape(sale.customer_email)}</div>
        </td>
        <td><span class="badge badge-${sale.status}">${this.escape(
          this.statusLabel(sale.status)
        )}</span></td>
        <td class="num">${sale.item_count}</td>
        <td class="num">${this.money(sale.total)}</td>
      </tr>`
      )
      .join('');

    const emptyRow = `<tr><td colspan="6" class="empty">Sin ventas para los filtros seleccionados.</td></tr>`;

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>Reporte de ventas — ${this.escape(data.business_name)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 18mm; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1a1d29; margin: 0; font-size: 11px; line-height: 1.45;
  }
  header { display: flex; align-items: center; gap: 14px;
           border-bottom: 2px solid #5b6ef5; padding-bottom: 12px; margin-bottom: 4px; }
  .logo { width: 52px; height: 52px; object-fit: contain; border-radius: 8px; }
  .logo-fallback { width: 52px; height: 52px; border-radius: 8px; background: #5b6ef5;
                   color: #fff; font-size: 26px; font-weight: 700;
                   display: flex; align-items: center; justify-content: center; }
  .head-main { flex: 1; }
  .biz { font-size: 17px; font-weight: 700; }
  .doc-title { font-size: 12px; color: #5b6ef5; font-weight: 600; letter-spacing: .04em;
               text-transform: uppercase; margin-top: 2px; }
  .head-meta { text-align: right; font-size: 10px; color: #6b7280; }
  .criteria { background: #f6f7fb; border: 1px solid #e4e7f2; border-radius: 6px;
              padding: 8px 10px; margin: 12px 0; font-size: 10px; }
  .criteria strong { color: #3d4256; }
  .kpis { display: flex; gap: 8px; margin-bottom: 14px; }
  .kpi { flex: 1; border: 1px solid #e4e7f2; border-radius: 6px; padding: 9px 11px; }
  .kpi-label { font-size: 9px; text-transform: uppercase; letter-spacing: .05em; color: #6b7280; }
  .kpi-value { font-size: 16px; font-weight: 700; margin-top: 3px; }
  .kpi-value.accent { color: #16a34a; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .05em;
       color: #6b7280; border-bottom: 1.5px solid #d6dae8; padding: 7px 6px; }
  td { padding: 7px 6px; border-bottom: 1px solid #eef0f6; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .num { text-align: right; white-space: nowrap; }
  .mono { font-family: "SF Mono", Consolas, monospace; font-size: 10px; }
  .muted { color: #8b90a3; font-size: 9.5px; }
  .empty { text-align: center; color: #8b90a3; padding: 22px; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 20px; font-size: 9px; font-weight: 600; }
  .badge-paid { background: #dcfce7; color: #166534; }
  .badge-fulfilled { background: #dbeafe; color: #1e40af; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-canceled { background: #fee2e2; color: #991b1b; }
  tfoot td { border-top: 1.5px solid #d6dae8; border-bottom: none;
             font-weight: 700; padding-top: 9px; }
  footer { margin-top: 16px; border-top: 1px solid #e4e7f2; padding-top: 8px;
           font-size: 9px; color: #8b90a3; display: flex; justify-content: space-between; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style>
</head>
<body>
  <header>
    ${logo}
    <div class="head-main">
      <div class="biz">${this.escape(data.business_name || 'Negocio')}</div>
      <div class="doc-title">Reporte de ventas</div>
    </div>
    <div class="head-meta">
      <div><strong>Emitido</strong></div>
      <div>${this.escape(this.formatDateTime(generated.toISOString()))}</div>
      <div class="mono">KARD</div>
    </div>
  </header>

  <div class="criteria">
    <strong>Criterios:</strong> ${this.escape(this.criteriaText())}
    &nbsp;·&nbsp; <strong>Registros:</strong> ${data.items.length} de ${data.total}
    ${
      data.total > data.items.length
        ? ` <em>(reporte limitado a ${EXPORT_MAX_ROWS} filas; acota el rango para incluir todo)</em>`
        : ''
    }
  </div>

  <div class="kpis">
    <div class="kpi">
      <div class="kpi-label">Ingreso total</div>
      <div class="kpi-value accent">${this.money(s.revenue)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Pedidos</div>
      <div class="kpi-value">${s.order_count}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Artículos vendidos</div>
      <div class="kpi-value">${s.units}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Ticket promedio</div>
      <div class="kpi-value">${this.money(avg)}</div>
    </div>
    <div class="kpi">
      <div class="kpi-label">Cancelados</div>
      <div class="kpi-value">${s.canceled_count}</div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Folio</th><th>Fecha</th><th>Cliente</th>
        <th>Estado</th><th class="num">Artículos</th><th class="num">Total</th>
      </tr>
    </thead>
    <tbody>${rows || emptyRow}</tbody>
    <tfoot>
      <tr>
        <td colspan="4">Total del periodo (excluye cancelados)</td>
        <td class="num">${s.units}</td>
        <td class="num">${this.money(s.revenue)}</td>
      </tr>
    </tfoot>
  </table>

  <footer>
    <span>Generado por KARD · Documento interno</span>
    <span>${this.escape(data.business_name || '')}</span>
  </footer>
</body>
</html>`;
  }

  /** Descripción legible de los filtros, para el encabezado del reporte. */
  criteriaText(): string {
    const parts: string[] = [];

    if (this.dateFrom && this.dateTo) {
      parts.push(`del ${this.formatDate(this.dateFrom)} al ${this.formatDate(this.dateTo)}`);
    } else if (this.dateFrom) {
      parts.push(`desde el ${this.formatDate(this.dateFrom)}`);
    } else if (this.dateTo) {
      parts.push(`hasta el ${this.formatDate(this.dateTo)}`);
    } else {
      parts.push('histórico completo');
    }

    if (this.status) parts.push(`estado ${this.statusLabel(this.status).toLowerCase()}`);
    if (this.search.trim()) parts.push(`búsqueda "${this.search.trim()}"`);

    return parts.join(' · ');
  }

  // ── Utilidades ──────────────────────────────────────────

  statusLabel(status: OrderStatus | string): string {
    return this.statusOptions.find(o => o.value === status)?.label ?? status;
  }

  formatDate(iso: string): string {
    const [y, m, d] = iso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  }

  formatDateTime(iso: string): string {
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(dt.getDate())}/${pad(dt.getMonth() + 1)}/${dt.getFullYear()} ${pad(
      dt.getHours()
    )}:${pad(dt.getMinutes())}`;
  }

  private money(value: string | number): string {
    const n = Number(value) || 0;
    return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  private fileStamp(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(
      d.getHours()
    )}${pad(d.getMinutes())}`;
  }

  /** Escapa una celda de CSV: comillas dobladas y campo entrecomillado. */
  private csvCell(value: string): string {
    return `"${(value ?? '').replace(/"/g, '""')}"`;
  }

  private escape(value: string): string {
    return (value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
