import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export interface MethodTotal {
  count: number;
  total: string;
}

/** Lo vendido en un turno, por método de pago. Los importes llegan como texto ("123.40"). */
export interface CashSummary {
  sales_count: number;
  gross: string;
  cash: MethodTotal;
  card: MethodTotal;
  transfer: MethodTotal;
  other: MethodTotal;
  discounts: string;
  tips_total: string;
  /** Parte de la propina que se cobró en efectivo (está dentro del cajón). */
  tips_cash: string;
  /** Ventas canceladas o reembolsadas: no cuentan en el corte. */
  excluded_count: number;
}

export interface CashSession {
  session_id: string;
  status: 'open' | 'closed';
  opened_at: string;
  opened_by: string | null;
  opening_float: string;
  closed_at: string | null;
  closed_by: string | null;
  /** Abierto: en vivo. Cerrado: lo que quedó congelado en el corte. */
  expected_cash: string;
  counted_cash: string | null;
  /** contado − esperado. Negativo = faltante. */
  difference: string | null;
  notes: string | null;
  summary: CashSummary;
}

export interface CashSessionList {
  items: CashSession[];
  total: number;
  page: number;
  page_size: number;
}

/** Códigos con los que la API explica por qué rechazó una operación de caja o de cobro. */
export type PosErrorCode =
  | 'CASH_CLOSED'
  | 'CASH_ALREADY_OPEN'
  | 'INVALID_DISCOUNT'
  | 'INSUFFICIENT_PAYMENT'
  | 'DUPLICATE_PRODUCT_CODE';

/**
 * Caja del negocio: abrir turno, cerrar con corte y consultar el historial.
 * Endpoints B2B; el tenant sale del token.
 */
@Injectable({ providedIn: 'root' })
export class CashService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  /** El turno abierto con sus cifras en vivo, o null si la caja está cerrada. */
  current(): Observable<CashSession | null> {
    return this.http.get<CashSession | null>(`${API}/cash/current`, { headers: this.headers });
  }

  open(openingFloat: string): Observable<CashSession> {
    return this.http.post<CashSession>(
      `${API}/cash/open`,
      { opening_float: openingFloat },
      { headers: this.headers },
    );
  }

  close(countedCash: string, notes?: string): Observable<CashSession> {
    return this.http.post<CashSession>(
      `${API}/cash/close`,
      { counted_cash: countedCash, ...(notes?.trim() ? { notes: notes.trim() } : {}) },
      { headers: this.headers },
    );
  }

  sessions(page = 1, pageSize = 10): Observable<CashSessionList> {
    const params = new HttpParams().set('page', page).set('page_size', pageSize);
    return this.http.get<CashSessionList>(`${API}/cash/sessions`, { headers: this.headers, params });
  }
}
