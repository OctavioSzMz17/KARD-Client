import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProductImage } from './image.service';
import { environment } from '../../../environments/environment';

const BASE = environment.serverUrl;

/** Tema visual del negocio (branding). */
export interface StorefrontTheme {
  primary?: string | null;
  accent?: string | null;
}

export interface HourEntry {
  days:  string;
  hours: string;
}

export interface Social {
  facebook?:  string | null;
  instagram?: string | null;
  tiktok?:    string | null;
  x?:         string | null;
  youtube?:   string | null;
}

export interface Contact {
  address?:  string | null;
  phone?:    string | null;
  email?:    string | null;
  whatsapp?: string | null;
  maps_url?: string | null;
  hours?:    HourEntry[];
  social?:   Social;
}

export interface StorefrontInfo {
  slug: string;
  business_name: string;
  business_type: 'restaurant' | 'optician';
  // branding (ya implementado en el backend)
  logo_url?:   string | null;
  banner_url?: string | null;
  theme?:      StorefrontTheme | null;
  // contenido editorial — aún no lo envía el backend; el front usa fallbacks
  tagline?:     string | null;
  description?: string | null;
  contact?:     Contact | null;
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
