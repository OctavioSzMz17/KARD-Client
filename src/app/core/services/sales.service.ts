import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { OrderItem, OrderStatus } from './order.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

/** Una venta vista desde el negocio (incluye al cliente). */
export interface Sale {
  order_id: string;
  status: OrderStatus;
  total: string;
  item_count: number;
  customer_name: string;
  customer_email: string;
  items: OrderItem[];
  created_at: string;
  // Desglose de caja. Las ventas anteriores a la caja traen ceros y null.
  payment_method?: PaymentMethod | null;
  captured_by?: 'consumer' | 'employee';
  subtotal?: string;
  discount_amount?: string;
  tip_amount?: string;
  amount_received?: string | null;
  change_given?: string | null;
  /** Quién cobró (nombre completo y código de empleado) y desde qué caja. Nulos en pedidos en línea. */
  cashier_name?: string | null;
  cashier_code?: string | null;
  register_name?: string | null;
}

/** Totales del conjunto filtrado completo, no solo de la página visible. */
export interface SalesSummary {
  order_count: number;
  canceled_count: number;
  revenue: string;
  units: number;
  /** Propinas y descuentos del conjunto filtrado (la propina ya va dentro de `revenue`). */
  tips?: string;
  discounts?: string;
}

export interface SalesReport {
  business_name: string;
  items: Sale[];
  summary: SalesSummary;
  total: number;
  page: number;
  page_size: number;
}

export type PaymentMethod = 'cash' | 'card' | 'transfer' | 'online';

/** Cómo se atiende una venta de mostrador. */
export type PosFulfillment = 'dine_in' | 'takeaway';

export interface PosSaleRequest {
  items: { product_id: string; quantity: number }[];
  payment_method: PaymentMethod;
  fulfillment_type: PosFulfillment;
  table_number?: string;
  customer_name?: string;
  discount?: { type: 'percent' | 'amount'; value: string };
  tip?: string;
  /** Solo con efectivo: lo que entregó el cliente. */
  amount_received?: string;
}

/** La venta ya cobrada, con todo lo que lleva el ticket. */
export interface PosSale {
  order_id: string;
  status: string;
  fulfillment_type: string;
  payment_method: PaymentMethod | null;
  subtotal: string;
  shipping_cost: string;
  discount_amount: string;
  tip_amount: string;
  total: string;
  amount_received: string | null;
  change_given: string | null;
  table_number: string | null;
  customer_name: string | null;
  /** Lo que dice el ticket: quien cobró ("Eva P.") y desde qué caja ("Caja 1"). */
  cashier: string | null;
  register_name: string | null;
  items: OrderItem[];
  created_at: string;
  business_name: string;
}

/** Lo vendido en un día del negocio (fecha local, `YYYY-MM-DD`). */
export interface DayStat {
  date: string;
  revenue: string;
  orders: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  units: number;
  revenue: string;
}

/** Ventas cobradas de los últimos días y lo más vendido, para el Dashboard. */
export interface SalesStats {
  days: DayStat[];
  top_products: TopProduct[];
  total_revenue: string;
  total_orders: number;
  average_ticket: string | null;
}

/** Filtros del reporte. Todos opcionales: sin ninguno devuelve el histórico. */
export interface SalesFilters {
  dateFrom?: string | null;   // 'YYYY-MM-DD', inclusivo
  dateTo?: string | null;     // 'YYYY-MM-DD', inclusivo (el servicio lo vuelve exclusivo)
  status?: OrderStatus | null;
  search?: string | null;
  page?: number;
  pageSize?: number;
}

/**
 * Ventas del negocio — endpoint B2B, requiere JWT de negocio.
 * El tenant sale del token, nunca se manda desde el front.
 */
@Injectable({ providedIn: 'root' })
export class SalesService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  list(filters: SalesFilters = {}): Observable<SalesReport> {
    let params = new HttpParams()
      .set('page', filters.page ?? 1)
      .set('page_size', filters.pageSize ?? 20);

    if (filters.dateFrom) {
      params = params.set('date_from', `${filters.dateFrom}T00:00:00`);
    }
    if (filters.dateTo) {
      // El backend trata date_to como exclusivo; sumamos un día para que el
      // usuario pueda elegir "hasta el 31" y que el 31 quede incluido.
      params = params.set('date_to', `${this.nextDay(filters.dateTo)}T00:00:00`);
    }
    if (filters.status) {
      params = params.set('status', filters.status);
    }
    if (filters.search?.trim()) {
      params = params.set('search', filters.search.trim());
    }

    return this.http.get<SalesReport>(`${API}/orders/business/sales`, {
      headers: this.headers,
      params,
    });
  }

  /**
   * Ventas cobradas de los últimos `days` días y lo más vendido. Los días son los del negocio: el
   * navegador manda su desfase con UTC (`getTimezoneOffset`), así una venta de las 9 de la noche
   * no cae en el día siguiente.
   */
  stats(days = 7): Observable<SalesStats> {
    const params = new HttpParams().set('days', days).set('tz_offset', new Date().getTimezoneOffset());
    return this.http.get<SalesStats>(`${API}/orders/business/stats`, { headers: this.headers, params });
  }

  /**
   * Cobra una venta de mostrador. Exige un turno de caja abierto (409 CASH_CLOSED si no).
   *
   * `idempotencyKey` identifica este ticket: si el mismo cobro llega dos veces (doble clic, un
   * reintento, o la laptop y el celular cobrando el mismo ticket) el servidor devuelve la venta
   * ya hecha en vez de crear otra.
   */
  charge(body: PosSaleRequest, idempotencyKey?: string): Observable<PosSale> {
    const headers = idempotencyKey ? this.headers.set('Idempotency-Key', idempotencyKey) : this.headers;
    return this.http.post<PosSale>(`${API}/orders/business/sales`, body, { headers });
  }

  /** Cambia el estado de una venta. Devuelve la venta ya actualizada. */
  updateStatus(orderId: string, status: OrderStatus): Observable<Sale> {
    return this.http.patch<Sale>(
      `${API}/orders/business/sales/${orderId}/status`,
      { status },
      { headers: this.headers }
    );
  }

  /** 'YYYY-MM-DD' → el día siguiente, en la misma forma. */
  private nextDay(isoDate: string): string {
    const [y, m, d] = isoDate.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt.toISOString().slice(0, 10);
  }
}
