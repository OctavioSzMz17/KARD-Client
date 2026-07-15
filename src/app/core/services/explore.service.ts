import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

const API = 'http://localhost:8000/api/v1';

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
  tagline?: string | null;    // eslogan corto — subtítulo de la card
}

export interface ExploreResponse {
  items: ExploreStore[];
  total: number;
  page: number;
  page_size: number;
}

/** Endpoints públicos de descubrimiento — no requieren token. */
@Injectable({ providedIn: 'root' })
export class ExploreService {
  private http = inject(HttpClient);

  getCategories(): Observable<CategoriesResponse> {
    return this.http.get<CategoriesResponse>(`${API}/explore/categories`);
  }

  getStores(opts: { category?: string; search?: string; page?: number; pageSize?: number } = {}): Observable<ExploreResponse> {
    let params = new HttpParams()
      .set('page', opts.page ?? 1)
      .set('page_size', opts.pageSize ?? 20);
    if (opts.category) params = params.set('category', opts.category);
    if (opts.search)   params = params.set('search', opts.search);
    return this.http.get<ExploreResponse>(`${API}/explore`, { params });
  }
}
