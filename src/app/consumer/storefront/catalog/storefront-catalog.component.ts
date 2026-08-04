import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { StorefrontProduct, StorefrontService } from '../../../core/services/storefront.service';
import { ProductImage } from '../../../core/services/image.service';
import { StorefrontStore } from '../../../core/store/storefront.store';

const PAGE_SIZE = 24;

@Component({
  selector: 'app-storefront-catalog',
  imports: [],
  templateUrl: './storefront-catalog.component.html',
  styleUrl: './storefront-catalog.component.scss'
})
export class StorefrontCatalogComponent implements OnInit {
  readonly sf = inject(StorefrontStore);
  private svc        = inject(StorefrontService);
  private destroyRef = inject(DestroyRef);

  products        = signal<StorefrontProduct[]>([]);
  total           = signal(0);
  loadingProducts = signal(true);
  loadingMore     = signal(false);
  searchQuery     = signal('');
  private page    = 1;

  private search$ = new Subject<string>();

  hasMore = computed(() => this.products().length < this.total());

  ngOnInit(): void {
    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(q => { this.searchQuery.set(q); this.fetch(true); });

    this.fetch(true);
  }

  onSearch(e: Event): void {
    this.search$.next((e.target as HTMLInputElement).value.trim());
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.page += 1;
    this.loadingMore.set(true);
    this.svc.getProducts(this.sf.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.products.update(items => [...items, ...res.items]);
          this.total.set(res.total);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false)
      });
  }

  private fetch(reset: boolean): void {
    if (reset) { this.page = 1; this.loadingProducts.set(true); }
    this.svc.getProducts(this.sf.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => { this.products.set(res.items); this.total.set(res.total); this.loadingProducts.set(false); },
        error: () => { this.products.set([]); this.total.set(0); this.loadingProducts.set(false); }
      });
  }

  // ── Helpers de presentación ───────────────────────────
  primaryImage(images: ProductImage[]): ProductImage | null {
    return images?.find(i => i.sort_order === 0) ?? images?.[0] ?? null;
  }

  /** Chips de metadata según el tipo de negocio. */
  metaChips(p: StorefrontProduct): string[] {
    const m = p.metadata ?? {};
    const type = this.sf.store()?.business_type;

    if (type === 'restaurant') {
      const chips: string[] = [];
      if (m['categoria'])              chips.push(String(m['categoria']).replace('_', ' '));
      if (m['tiempo_preparacion_min']) chips.push(`${m['tiempo_preparacion_min']} min`);
      if (m['picante'])                chips.push('🌶 picante');
      return chips;
    }
    if (type === 'optician') {
      const chips: string[] = [];
      if (m['material']) chips.push(m['material']);
      if (m['esfera'] !== undefined && m['cilindro'] !== undefined) chips.push(`${m['esfera']} / ${m['cilindro']}`);
      return chips;
    }
    return [];
  }
}
