import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export interface CartItem {
  product_id: string;
  name: string;
  quantity: number;
  price_snapshot: string;
  subtotal: string;
}

export interface Cart {
  slug: string;
  business_name: string;
  items: CartItem[];
  total: string;
  item_count: number;
}

/**
 * Carrito del consumer — vive en Redis del lado del servidor,
 * uno por tienda (clave cart:{consumer_id}:{slug}, TTL 7 días).
 * Todos los endpoints requieren JWT de consumer.
 */
@Injectable({ providedIn: 'root' })
export class CartService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  get(slug: string): Observable<Cart> {
    return this.http.get<Cart>(`${API}/cart/${slug}`, { headers: this.headers });
  }

  /** Agrega o fija la cantidad absoluta de un producto. quantity=0 lo elimina. */
  setItem(slug: string, productId: string, quantity: number): Observable<Cart> {
    return this.http.post<Cart>(`${API}/cart/${slug}/items`,
      { product_id: productId, quantity },
      { headers: this.headers });
  }

  removeItem(slug: string, productId: string): Observable<Cart> {
    return this.http.delete<Cart>(`${API}/cart/${slug}/items/${productId}`, { headers: this.headers });
  }

  clear(slug: string): Observable<void> {
    return this.http.delete<void>(`${API}/cart/${slug}`, { headers: this.headers });
  }
}
