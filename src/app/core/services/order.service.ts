import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export type OrderStatus = 'pending' | 'paid' | 'fulfilled' | 'canceled';

/** Qué hacer si falta stock al confirmar el pedido. */
export type OnInsufficientStock = 'reject' | 'skip';

/** Cómo recibe el cliente su pedido. */
export type FulfillmentType = 'dine_in' | 'takeaway' | 'pickup' | 'delivery';

/** Dirección de entrega. Se copia dentro del pedido, no se referencia. */
export interface ShippingAddress {
  street: string;
  neighborhood?: string | null;
  city: string;
  state?: string | null;
  postal_code?: string | null;
  phone?: string | null;
  notes?: string | null;
}

/** Elección de entrega del cliente, con los datos que exige cada modo. */
export interface FulfillmentChoice {
  fulfillment_type: FulfillmentType;
  table_number?: string | null;
  shipping_address?: ShippingAddress | null;
}

export interface OrderItem {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  subtotal: string;
}

/** Producto que se omitió del pedido (solo aparece cuando se confirma con 'skip'). */
export interface SkippedItem {
  product_id: string;
  product_name: string;
  reason: StockReason;
}

export interface Order {
  order_id: string;
  slug: string;
  business_name: string;
  status: OrderStatus;
  total: string;
  items: OrderItem[];
  skipped: SkippedItem[];
  created_at: string;
}

export interface OrderListResponse {
  items: Order[];
  total: number;
  page: number;
  page_size: number;
}

// ── Conflicto de stock (409) ───────────────────────────────
export type StockReason =
  | 'product_shortage'
  | 'ingredient_shortage'
  | 'product_and_ingredient'
  | 'unavailable';

export interface MissingIngredient {
  insumo_id: string;
  insumo_name: string;
  required: number;
  available: number;
  unit: string;
}

export interface UnavailableProduct {
  product_id: string;
  product_name: string;
  requested: number;
  reason: StockReason;
  available?: number;                        // presente en product_shortage / product_and_ingredient
  missing_ingredients?: MissingIngredient[]; // presente en ingredient_shortage / product_and_ingredient
}

/** Cuerpo del 409 con code === 'INSUFFICIENT_STOCK'. */
export interface StockConflict {
  success: false;
  code: 'INSUFFICIENT_STOCK';
  error: string;
  details: {
    all_unavailable: boolean;   // true = ni con 'skip' se puede crear el pedido
    unavailable: UnavailableProduct[];
  };
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

  /**
   * Convierte el carrito de la tienda en un pedido.
   * - 'reject' (default): si falta stock → 409 INSUFFICIENT_STOCK, no crea nada, carrito intacto.
   * - 'skip': omite los productos sin stock, crea el pedido con el resto (llegan en `skipped`)
   *   y vacía el carrito.
   *
   * `fulfillment` dice cómo recibe el pedido el cliente. Cada modo exige sus
   * datos — mesa para consumo en el local, dirección para envío — y el
   * backend rechaza la combinación incoherente con un 422.
   */
  create(
    slug: string,
    fulfillment: FulfillmentChoice,
    onInsufficientStock: OnInsufficientStock = 'reject',
  ): Observable<Order> {
    const body: Record<string, unknown> = {
      slug,
      on_insufficient_stock: onInsufficientStock,
      fulfillment_type: fulfillment.fulfillment_type,
    };
    if (fulfillment.table_number)    body['table_number']    = fulfillment.table_number;
    if (fulfillment.shipping_address) body['shipping_address'] = fulfillment.shipping_address;

    return this.http.post<Order>(`${API}/orders`, body, { headers: this.headers });
  }

  list(page = 1, pageSize = 20): Observable<OrderListResponse> {
    const params = new HttpParams().set('page', page).set('page_size', pageSize);
    return this.http.get<OrderListResponse>(`${API}/orders`, { headers: this.headers, params });
  }

  get(orderId: string): Observable<Order> {
    return this.http.get<Order>(`${API}/orders/${orderId}`, { headers: this.headers });
  }
}
