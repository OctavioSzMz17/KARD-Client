import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, shareReplay, throwError } from 'rxjs';
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

/** Cómo puede recibir su pedido el cliente en esta tienda. */
export interface StorefrontFulfillment {
  dine_in:  boolean;
  takeaway: boolean;
  pickup:   boolean;
  delivery: boolean;
  shipping_flat_fee: string;
  free_shipping_above: string | null;
  delivery_notes: string | null;
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
  /** Modos de entrega habilitados por el negocio. */
  fulfillment?: StorefrontFulfillment | null;
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

/**
 * Cuánto se reutiliza una respuesta sin volver a pedirla. Es el mismo minuto
 * que el servidor declara en `Cache-Control`: el negocio y el catálogo
 * cambian cuando su dueño los edita, no mientras alguien navega.
 */
const CACHE_TTL_MS = 60_000;
const CACHE_MAX_ENTRIES = 60;

/** Endpoints públicos de la tienda — el contexto del negocio viene del slug. */
@Injectable({ providedIn: 'root' })
export class StorefrontService {
  private http = inject(HttpClient);

  private cache = new Map<string, { at: number; request$: Observable<unknown> }>();

  getStore(slug: string): Observable<StorefrontInfo> {
    return this.cached(`store:${slug}`, () => this.http.get<StorefrontInfo>(`${BASE}/s/${slug}`));
  }

  getProducts(slug: string, opts: { search?: string; page?: number; pageSize?: number } = {}): Observable<StorefrontProductsResponse> {
    const page = opts.page ?? 1;
    const pageSize = opts.pageSize ?? 20;
    let params = new HttpParams().set('page', page).set('page_size', pageSize);
    if (opts.search) params = params.set('search', opts.search);

    return this.cached(
      `products:${slug}:${page}:${pageSize}:${opts.search ?? ''}`,
      () => this.http.get<StorefrontProductsResponse>(`${BASE}/s/${slug}/products`, { params }),
    );
  }

  getProduct(slug: string, productId: string): Observable<StorefrontProduct> {
    return this.cached(`product:${slug}:${productId}`, () =>
      this.http.get<StorefrontProduct>(`${BASE}/s/${slug}/products/${productId}`));
  }

  /** Olvida lo guardado; para cuando algo propio lo deja viejo. */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Cache en memoria de GETs públicos.
   *
   * Guarda la petición, no solo el resultado: si dos componentes piden lo
   * mismo a la vez (el layout y el catálogo piden el negocio), viaja una sola.
   * Un error nunca se guarda, para que reintentar vuelva a intentarlo.
   */
  private cached<T>(key: string, request: () => Observable<T>): Observable<T> {
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.request$ as Observable<T>;

    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      // Las búsquedas distintas llenarían el mapa: se suelta la más vieja.
      this.cache.delete(this.cache.keys().next().value as string);
    }

    const request$ = request().pipe(
      catchError(err => {
        this.cache.delete(key);
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.cache.set(key, { at: Date.now(), request$ });
    return request$;
  }
}
