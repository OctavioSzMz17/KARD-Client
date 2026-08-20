import { Component, computed, inject, signal, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DecimalPipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { BrandingService } from '../../core/services/branding.service';
import { OrderStatus } from '../../core/services/order.service';
import { Sale, SalesFilters, SalesReport, SalesService } from '../../core/services/sales.service';
import { buildSalesReportHtml } from './sales-report';

/** Tamaño de página de la tabla en pantalla. */
const PAGE_SIZE = 20;

/**
 * Tope de filas que se piden al exportar. El reporte debe traer TODO el
 * conjunto filtrado, no la página visible; este techo evita que un filtro
 * demasiado abierto tumbe el navegador.
 */
const EXPORT_MAX_ROWS = 2000;

/**
 * Máximo que acepta el endpoint por página (`le=100`). El export junta el
 * conjunto completo pidiendo varias páginas de este tamaño: pedir las 2000
 * de un tirón devuelve 422.
 */
const API_MAX_PAGE_SIZE = 100;

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

  /** Estados que el negocio puede asignar (sin la opción "todos"). */
  assignableStatuses = computed(() =>
    this.statusOptions.filter(o => o.value !== '') as { value: OrderStatus; label: string }[]
  );

  /** Folio cuyo estado se está guardando, para bloquear solo esa fila. */
  savingStatusFor = signal<string | null>(null);

  changeStatus(sale: Sale, event: Event): void {
    const next = (event.target as HTMLSelectElement).value as OrderStatus;
    if (!next || next === sale.status) return;

    this.savingStatusFor.set(sale.order_id);
    this.error.set(null);

    this.salesService.updateStatus(sale.order_id, next).subscribe({
      next: () => {
        this.savingStatusFor.set(null);
        // Recargamos en vez de parchear la fila: el cambio mueve los totales
        // (un cancelado sale del ingreso) y el resumen viene del servidor.
        this.load();
      },
      error: err => {
        this.savingStatusFor.set(null);
        this.error.set(err?.error?.error ?? 'No se pudo cambiar el estado del pedido.');
        // Devolvemos el select a lo que dice el servidor.
        (event.target as HTMLSelectElement).value = sale.status;
      },
    });
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
      const first = await firstValueFrom(
        this.salesService.list(this.currentFilters(1, API_MAX_PAGE_SIZE))
      );

      const wanted = Math.min(first.total, EXPORT_MAX_ROWS);
      const items = [...first.items];
      let page = 2;

      while (items.length < wanted) {
        const next = await firstValueFrom(
          this.salesService.list(this.currentFilters(page, API_MAX_PAGE_SIZE))
        );
        // Defensivo: una página vacía cortaría el bucle aunque `total` mienta.
        if (next.items.length === 0) break;
        items.push(...next.items);
        page++;
      }

      return { ...first, items: items.slice(0, wanted) };
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

    win.document.write(
      buildSalesReportHtml(data, {
        logoUrl: this.logoUrl,
        criteria: this.criteriaText(),
        statusLabel: s => this.statusLabel(s),
        formatDateTime: iso => this.formatDateTime(iso),
        maxRows: EXPORT_MAX_ROWS,
      })
    );
    win.document.close();
    win.focus();
    // Esperamos al logo: si se imprime antes de que cargue, sale en blanco.
    setTimeout(() => win.print(), 400);
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

  private triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}
