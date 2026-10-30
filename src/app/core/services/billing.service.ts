import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export type Plan = 'starter' | 'pro' | 'enterprise';

/**
 * Estado de la suscripción del negocio.
 *
 * `has_access` viene resuelto del backend a propósito: el frontend no
 * debería tener que conocer qué estados de Stripe dan derecho a usar la
 * plataforma — eso es una regla de negocio, y vive de aquel lado.
 */
export interface PlanInfo {
  plan: Plan | null;
  subscription_status: string;
  current_period_end: string | null;
  has_access: boolean;
}

export interface CheckoutResponse {
  checkout_url: string;
  plan: string;
}

/**
 * Suscripción del negocio hacia KARD — endpoints B2B.
 * El cobro ocurre en Stripe: KARD nunca toca datos de tarjeta.
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  getPlan(): Observable<PlanInfo> {
    return this.http.get<PlanInfo>(`${API}/billing/plan`, { headers: this.headers });
  }

  /** Devuelve la URL de Stripe a la que hay que redirigir al negocio. */
  checkout(plan: Plan): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(
      `${API}/billing/checkout`, { plan }, { headers: this.headers }
    );
  }
}
