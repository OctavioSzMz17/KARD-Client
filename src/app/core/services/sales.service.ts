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
}

/** Totales del conjunto filtrado completo, no solo de la página visible. */
export interface SalesSummary {
  order_count: number;
  canceled_count: number;
  revenue: string;
  units: number;
}

export interface SalesReport {
  business_name: string;
  items: Sale[];
  summary: SalesSummary;
  total: number;
  page: number;
  page_size: number;
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
