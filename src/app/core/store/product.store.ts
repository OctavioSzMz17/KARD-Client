import { Injectable, inject, signal, computed } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthService } from '../services/auth.service';
import { ProductImage } from '../services/image.service';

const API        = 'http://localhost:8000/api/v1';
const CACHE_TTL  = 5 * 60 * 1000; // 5 minutes

export interface Product {
  product_id:          string;
  name:                string;
  description:         string;
  price:               string;
  inventory_count:     number;
  low_stock_threshold: number;
  product_type:        string;
  metadata:            Record<string, any>;
  images:              ProductImage[];
  is_deleted:          boolean;
}

interface ProductsResponse {
  items:     Product[];
  total:     number;
  page:      number;
  page_size: number;
}

@Injectable({ providedIn: 'root' })
export class ProductStore {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // ── State ────────────────────────────────────────────
  readonly products  = signal<Product[]>([]);
  readonly loading   = signal(false);
  readonly error     = signal<string | null>(null);
  private lastFetch    = 0;
  private lastTenantId = '';

  // ── Derived ──────────────────────────────────────────
  readonly isEmpty = computed(() => !this.loading() && this.products().length === 0);

  /** Cache is valid only when within TTL AND the same tenant is active. */
  readonly isFresh = () => {
    const currentTenant = this.auth.getSession()?.tenant_id ?? '';
    return !!this.lastFetch
      && (Date.now() - this.lastFetch) < CACHE_TTL
      && this.lastTenantId === currentTenant;
  };

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  // ── Load (respects cache) ────────────────────────────
  load(): void {
    if (this.isFresh()) return;   // cache hit — nothing to do
    this.fetch();
  }

  // ── Force reload (after any mutation) ────────────────
  reload(): void {
    this.invalidate();
    this.fetch();
  }

  // ── Mark cache stale without triggering a fetch ──────
  invalidate(): void {
    this.lastFetch = 0;
  }

  // ── Full reset — call on logout / account switch ──────
  clear(): void {
    this.products.set([]);
    this.lastFetch    = 0;
    this.lastTenantId = '';
    this.error.set(null);
  }

  // ── Internal fetch ───────────────────────────────────
  private fetch(): void {
    if (this.loading()) return;   // already in flight
    this.loading.set(true);
    this.error.set(null);

    this.http
      .get<ProductsResponse>(`${API}/products?page_size=100`, { headers: this.headers })
      .subscribe({
        next: (res) => {
          this.products.set(res.items);
          this.lastFetch    = Date.now();
          this.lastTenantId = this.auth.getSession()?.tenant_id ?? '';
          this.loading.set(false);
        },
        error: () => {
          this.error.set('No se pudo cargar el catálogo.');
          this.loading.set(false);
        }
      });
  }

  // ── Mutations ─────────────────────────────────────────
  create(body: object): Observable<Product> {
    return this.http
      .post<Product>(`${API}/products`, body, { headers: this.headers })
      .pipe(tap(() => this.reload()));
  }

  update(id: string, body: object): Observable<Product> {
    return this.http
      .patch<Product>(`${API}/products/${id}`, body, { headers: this.headers })
      .pipe(tap((updated) => this._patchLocal(updated)));
  }

  remove(id: string): Observable<void> {
    return this.http
      .delete<void>(`${API}/products/${id}`, { headers: this.headers })
      .pipe(tap(() => this._removeLocal(id)));
  }

  sell(id: string, quantity: number, notes?: string): Observable<any> {
    const body = notes ? { quantity, notes } : { quantity };
    return this.http
      .post<any>(`${API}/products/${id}/sell`, body, { headers: this.headers })
      .pipe(tap((res) => this._updateStock(id, res.inventory_count)));
  }

  restock(id: string, quantity: number, notes?: string): Observable<any> {
    const body = notes ? { quantity, notes } : { quantity };
    return this.http
      .post<any>(`${API}/products/${id}/restock`, body, { headers: this.headers })
      .pipe(tap((res) => this._updateStock(id, res.inventory_count)));
  }

  // ── Optimistic local updates ──────────────────────────
  updateImages(productId: string, images: ProductImage[]): void {
    this.products.update(list =>
      list.map(p => p.product_id === productId ? { ...p, images } : p)
    );
  }

  private _patchLocal(updated: Product): void {
    this.products.update(list =>
      list.map(p => p.product_id === updated.product_id ? { ...p, ...updated } : p)
    );
  }

  private _removeLocal(id: string): void {
    this.products.update(list => list.filter(p => p.product_id !== id));
  }

  private _updateStock(id: string, newCount: number): void {
    this.products.update(list =>
      list.map(p => p.product_id === id ? { ...p, inventory_count: newCount } : p)
    );
  }
}
