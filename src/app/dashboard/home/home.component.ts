import { Component, inject, OnInit, computed } from '@angular/core';
import { ProductStore, Product } from '../../core/store/product.store';

@Component({
  selector: 'app-home',
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss'
})
export class HomeComponent implements OnInit {
  private store = inject(ProductStore);

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
