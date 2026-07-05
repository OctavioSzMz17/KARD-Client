import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProductImage } from './image.service';

const BASE = 'http://localhost:8000';

/** Tema visual del negocio — el backend aún no lo envía; defaults en el componente. */
export interface StorefrontTheme {
  primary?: string;
  accent?: string;
}

export interface StorefrontInfo {
  slug: string;
  business_name: string;
  business_type: 'restaurant' | 'optician';
  // preparados para la config del negocio (logos, imágenes, colores)
  logo_url?: string;
  banner_url?: string;
  theme?: StorefrontTheme;
}

export interface StorefrontProduct {
  product_id: string;
  name: string;
  description: string;
  price: string;
  product_type: string;
  metadata: Record<string, any>;
  images: ProductImage[];
}

export interface StorefrontProductsResponse {
  items: StorefrontProduct[];
  total: number;
  page: number;
  page_size: number;
}

/** Endpoints públicos de la tienda — el contexto del negocio viene del slug. */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private http = inject(HttpClient);

  getStore(slug: string): Observable<StorefrontInfo> {
    return this.http.get<StorefrontInfo>(`${BASE}/s/${slug}`);
  }

  getProducts(slug: string, opts: { search?: string; page?: number; pageSize?: number } = {}): Observable<StorefrontProductsResponse> {
    let params = new HttpParams()
      .set('page', opts.page ?? 1)
      .set('page_size', opts.pageSize ?? 20);
    if (opts.search) params = params.set('search', opts.search);
    return this.http.get<StorefrontProductsResponse>(`${BASE}/s/${slug}/products`, { params });
  }

  getProduct(slug: string, productId: string): Observable<StorefrontProduct> {
    return this.http.get<StorefrontProduct>(`${BASE}/s/${slug}/products/${productId}`);
  }
}
