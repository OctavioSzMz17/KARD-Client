import { Component, inject, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../core/services/auth.service';
import { Fulfillment, FulfillmentService } from '../../core/services/fulfillment.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ProductStore, Product } from '../../core/store/product.store';

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

  // ── Loading state (shared with products page) ─────────
  readonly loading = this.store.loading;

  // ── Stats derived from the shared cache ───────────────
  readonly totalProducts   = computed(() => this.store.products().length);
  readonly totalInventory  = computed(() => this.store.products().reduce((s, p) => s + p.inventory_count, 0));
  readonly lowStockCount   = computed(() => this.store.products().filter(p =>
    p.inventory_count > 0 && p.inventory_count < p.low_stock_threshold).length
  );
  readonly outOfStockCount = computed(() => this.store.products().filter(p =>
    p.inventory_count === 0).length
  );
  readonly lowStockItems   = computed(() =>
    this.store.products()
      .filter(p => p.inventory_count > 0 && p.inventory_count < p.low_stock_threshold)
      .slice(0, 3)
  );
  readonly recentProducts  = computed(() => this.store.products().slice(0, 5));

  // ── Chart data (generated once per component mount) ───
  salesChartPoints = this.generateChartPoints(7, 200, 900);
  stockChartPoints = this.generateChartPoints(10, 100, 500);

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
  }

  private generateChartPoints(count: number, min: number, max: number): string {
    const w = 280, h = 80;
    const pts = Array.from({ length: count }, (_, i) => ({
      x: (i / (count - 1)) * w,
      y: h - ((Math.random() * (max - min) + min) / max) * h
    }));
    return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  }

  getStockColor(item: Product): string {
    if (item.inventory_count === 0) return '#e05252';
    if (item.inventory_count < item.low_stock_threshold) return '#f59e0b';
    return '#10b981';
  }
}
