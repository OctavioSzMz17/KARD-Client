import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { MemoCache } from '../utils/memo-cache';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export interface CategoryItem {
  business_type: string;
  store_count: number;
}

export interface CategoriesResponse {
  categories: CategoryItem[];
}

export interface ExploreStore {
  slug: string;
  business_name: string;
  business_type: string;
  logo_url?: string | null;   // logo del negocio (branding)
  banner_url?: string | null; // portada de la tarjeta (el logo es un logotipo: recortado como foto se ve mal)
  tagline?: string | null;    // eslogan corto — subtítulo de la card
}

export interface ExploreResponse {
  items: ExploreStore[];
  total: number;
  page: number;
  page_size: number;
}

/**
 * Endpoints públicos de descubrimiento — no requieren token.
 *
 * Las respuestas se guardan un minuto en memoria (como en la tienda): al volver
 * de una tienda a explorar, o al alternar entre categorías, no se vuelve a pedir
 * lo que ya se tiene.
 */
@Injectable({ providedIn: 'root' })
export class ExploreService {
  private http = inject(HttpClient);
  private memo = new MemoCache();

  getCategories(): Observable<CategoriesResponse> {
    return this.memo.get('categories', () => this.http.get<CategoriesResponse>(`${API}/explore/categories`));
  }

  getStores(opts: { category?: string; search?: string; page?: number; pageSize?: number } = {}): Observable<ExploreResponse> {
    let params = new HttpParams()
      .set('page', opts.page ?? 1)
      .set('page_size', opts.pageSize ?? 20);
    if (opts.category) params = params.set('category', opts.category);
    if (opts.search)   params = params.set('search', opts.search);
    const key = `stores:${opts.category ?? ''}:${opts.search ?? ''}:${opts.page ?? 1}:${opts.pageSize ?? 20}`;
    return this.memo.get(key, () => this.http.get<ExploreResponse>(`${API}/explore`, { params }));
  }

  /** Olvida lo guardado; para cuando algo propio lo deja viejo. */
  clearCache(): void {
    this.memo.clear();
  }
}
