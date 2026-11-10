import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { Fulfillment, FulfillmentService } from '../../core/services/fulfillment.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ProductStore, Product } from '../../core/store/product.store';
import { PERM } from '../../core/permissions';
import { SalesService, SalesStats } from '../../core/services/sales.service';
import { formatMoney } from '../pos/pos-math';
import { areaPath, barPercent, dayLabels, linePath } from './chart-math';
import { lowStock, outOfStock, stockColor, stockDetail, totalStock, tracksStock } from '../../core/stock-logic';

/** Modo de entrega tal como se presenta en la configuración. */
interface ModoEntrega {
  key: 'dine_in' | 'takeaway' | 'pickup' | 'delivery';
  titulo: string;
  detalle: string;
  /** Giros donde la opción tiene sentido; vacío = sirve para todos. */
  soloPara?: string[];
}

@Component({
  selector: 'app-home',
  imports: [FormsModule],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private store   = inject(ProductStore);
  private auth    = inject(AuthService);
  private fulSvc  = inject(FulfillmentService);
  private snack   = inject(SnackbarService);
  private sales   = inject(SalesService);

  // ── Loading state (shared with products page) ─────────
  readonly loading = this.store.loading;

  // ── Stats derived from the shared cache ───────────────
  readonly totalProducts   = computed(() => this.store.products().length);
  // Las existencias solo cuentan en lo que las lleva: en un restaurante, los insumos (no los platillos).
  readonly totalInventory  = computed(() => totalStock(this.store.products()));
  readonly lowStockCount   = computed(() => lowStock(this.store.products()).length);
  readonly outOfStockCount = computed(() => outOfStock(this.store.products()).length);
  readonly lowStockItems   = computed(() => lowStock(this.store.products()).slice(0, 3));
  /** Hay productos sin existencias (platillos): el total que se muestra es solo de insumos. */
  readonly hasUntracked    = computed(() => this.store.products().some(p => !tracksStock(p)));
  readonly recentProducts  = computed(() => this.store.products().slice(0, 5));

  // ── Ventas reales de los últimos 7 días ───────────────
  readonly money = formatMoney;

  /** Las ventas son de quien puede verlas; el resto del inicio (inventario) no depende de eso. */
  readonly canSeeSales = computed(() => this.auth.can(PERM.salesRead));
  readonly stats = signal<SalesStats | null>(null);
  readonly statsLoading = signal(false);
  readonly statsError = signal(false);

  private readonly revenueByDay = computed(() => (this.stats()?.days ?? []).map(d => Number(d.revenue)));
  readonly salesLine = computed(() => linePath(this.revenueByDay(), 280, 100));
  readonly salesArea = computed(() => areaPath(this.revenueByDay(), 280, 100));
  readonly dayNames = computed(() => dayLabels((this.stats()?.days ?? []).map(d => d.date)));
  readonly hasSales = computed(() => (this.stats()?.total_orders ?? 0) > 0);

  /** Los más vendidos con el ancho de su barra respecto al primero. */
  readonly topProducts = computed(() => {
    const list = this.stats()?.top_products ?? [];
    const max = Math.max(0, ...list.map(p => p.units));
    return list.map(p => ({ ...p, percent: barPercent(p.units, max) }));
  });

  // ── Configuración de la tienda ────────────────────────
  settingsOpen    = signal(false);
  settingsLoading = signal(false);
  settingsSaving  = signal(false);
  fulfillment     = signal<Fulfillment | null>(null);

  /**
   * `dine_in` solo se ofrece donde se consume en el local. Mostrárselo a una
   * óptica sería ruido, y además el backend rechazaría ese modo.
   */
  readonly modos: ModoEntrega[] = [
    { key: 'dine_in',  titulo: 'Consumo en el local', detalle: 'El cliente pide desde su mesa y come ahí mismo.', soloPara: ['restaurant'] },
    { key: 'takeaway', titulo: 'Para llevar',          detalle: 'Se lo lleva en el momento, sin esperar.' },
    { key: 'pickup',   titulo: 'Recoger después',      detalle: 'Pide ahora y pasa por el pedido más tarde.' },
    { key: 'delivery', titulo: 'Envío a domicilio',    detalle: 'Se le lleva a su dirección. Puede tener costo.' },
  ];

  readonly modosVisibles = computed(() => {
    const giro = this.auth.getSession()?.business_type;
    return this.modos.filter(m => !m.soloPara || (giro ? m.soloPara.includes(giro) : false));
  });

  /** Al menos un modo activo: un negocio sin ninguno no podría vender. */
  readonly algunModoActivo = computed(() => {
    const f = this.fulfillment();
    return !!f && (f.dine_in || f.takeaway || f.pickup || f.delivery);
  });

  openSettings(): void {
    this.settingsOpen.set(true);
    this.settingsLoading.set(true);
    this.fulSvc.get().subscribe({
      next: f => { this.fulfillment.set(f); this.settingsLoading.set(false); },
      error: () => {
        this.settingsLoading.set(false);
        this.snack.error('No se pudo cargar la configuración');
      },
    });
  }

  closeSettings(): void {
    if (this.settingsSaving()) return;
    this.settingsOpen.set(false);
  }

  toggleModo(key: ModoEntrega['key']): void {
    const f = this.fulfillment();
    if (!f) return;
    this.fulfillment.set({ ...f, [key]: !f[key] });
  }

  onFee(e: Event): void {
    const f = this.fulfillment();
    if (!f) return;
    this.fulfillment.set({ ...f, shipping_flat_fee: Number((e.target as HTMLInputElement).value) });
  }

  onFreeAbove(e: Event): void {
    const f = this.fulfillment();
    if (!f) return;
    const raw = (e.target as HTMLInputElement).value.trim();
    this.fulfillment.set({ ...f, free_shipping_above: raw === '' ? null : Number(raw) });
  }

  onNotes(e: Event): void {
    const f = this.fulfillment();
    if (!f) return;
    this.fulfillment.set({ ...f, delivery_notes: (e.target as HTMLInputElement).value || null });
  }

  saveSettings(): void {
    const f = this.fulfillment();
    if (!f || !this.algunModoActivo()) return;

    // El backend rechaza cobrar envío con el envío apagado; se limpia aquí
    // para que el negocio no choque contra un 422 por un campo que ya no usa.
    const payload: Fulfillment = f.delivery
      ? f
      : { ...f, shipping_flat_fee: 0, free_shipping_above: null };

    this.settingsSaving.set(true);
    this.fulSvc.update(payload).subscribe({
      next: saved => {
        this.fulfillment.set(saved);
        this.settingsSaving.set(false);
        this.settingsOpen.set(false);
        this.snack.success('Configuración de entregas guardada');
      },
      error: err => {
        this.settingsSaving.set(false);
        this.snack.error(err?.error?.error ?? 'No se pudo guardar');
      },
    });
  }

  ngOnInit(): void {
    this.store.load();   // no-op if cache is fresh; fetches only when stale/empty
    if (this.canSeeSales()) this.loadStats();
  }

  loadStats(): void {
    this.statsLoading.set(true);
    this.statsError.set(false);
    this.sales.stats(7).subscribe({
      next: s => { this.stats.set(s); this.statsLoading.set(false); },
      error: () => { this.statsError.set(true); this.statsLoading.set(false); },
    });
  }

  readonly stockColor  = stockColor;
  readonly stockDetail = stockDetail;
}
