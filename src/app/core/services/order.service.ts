import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

const API = 'http://localhost:8000/api/v1';

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';

export interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

export interface Order {
  order_id: string;
  slug: string;
  business_name: string;
  status: OrderStatus;
  total: string;
  items: OrderItem[];
  created_at: string;
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
}

/** Pedidos del consumer — requieren JWT de consumer. */
@Injectable({ providedIn: 'root' })
export class OrderService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  /** Convierte el carrito de la tienda en un pedido (borra el carrito al confirmar). */
  create(slug: string): Observable<Order> {
    return this.http.post<Order>(`${API}/orders`, { slug }, { headers: this.headers });
  }

  list(page = 1, pageSize = 20): Observable<OrderListResponse> {
    const params = new HttpParams().set('page', page).set('page_size', pageSize);
    return this.http.get<OrderListResponse>(`${API}/orders`, { headers: this.headers, params });
  }

  get(orderId: string): Observable<Order> {
    return this.http.get<Order>(`${API}/orders/${orderId}`, { headers: this.headers });
  }
}
