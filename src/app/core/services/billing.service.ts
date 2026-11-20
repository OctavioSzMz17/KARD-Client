import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import {
  ChangePlanPreview, ChangePlanResponse, Channel, CheckoutResponse, Plan, PlanInfo,
} from '../models/plan.models';

export type { Channel, CheckoutResponse, Plan, PlanInfo } from '../models/plan.models';

const API = environment.apiUrl;

/**
 * Suscripción del negocio hacia ZNVX BX — endpoints B2B, solo el dueño (`billing:manage`).
 * El cobro ocurre en Stripe: ZNVX BX nunca toca datos de tarjeta.
 *
 * Qué llamada usar lo decide `PlanInfo.has_subscription`: sin suscripción,
 * `checkout`; con ella, `previewChange` + `changePlan`. El servidor rechaza con
 * 409 la equivocada (ver `BillingConflictCode`).
 */
@Injectable({ providedIn: 'root' })
export class BillingService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  /** §4. Estado, uso y mitad del negocio. */
  getPlan(): Observable<PlanInfo> {
    return this.http.get<PlanInfo>(`${API}/billing/plan`, { headers: this.headers });
  }

  /**
   * §5.1. Primer pago (desde la prueba o al volver tras vencer o cancelar).
   * `channel` es obligatorio para Starter (422 si falta) y no aplica en Pro.
   * Devuelve la URL de Stripe a la que hay que redirigir.
   */
  checkout(plan: Plan, channel?: Channel): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(
      `${API}/billing/checkout`, { plan, ...(channel ? { channel } : {}) }, { headers: this.headers },
    );
  }

  /**
   * §5.2 paso 1. Cuánto cuesta subir o bajar, antes de hacerlo. Al bajar a
   * Starter `channel` es opcional si ya tenía una mitad.
   */
  previewChange(plan: Plan, channel?: Channel): Observable<ChangePlanPreview> {
    let params = new HttpParams().set('plan', plan);
    if (channel) params = params.set('channel', channel);
    return this.http.get<ChangePlanPreview>(
      `${API}/billing/change-plan/preview`, { headers: this.headers, params },
    );
  }

  /**
   * §5.2 paso 2. Confirma el cambio. Manda la MISMA `proration_date` de la
   * vista previa, para que se cobre exactamente lo que se mostró.
   */
  changePlan(plan: Plan, channel?: Channel, prorationDate?: number): Observable<ChangePlanResponse> {
    return this.http.post<ChangePlanResponse>(
      `${API}/billing/change-plan`,
      {
        plan,
        ...(channel ? { channel } : {}),
        ...(prorationDate !== undefined ? { proration_date: prorationDate } : {}),
      },
      { headers: this.headers },
    );
  }

  /** §5.3. Cambia la mitad de Starter (una vez cada 30 días). Responde el `PlanInfo` ya actualizado. */
  changeChannel(channel: Channel): Observable<PlanInfo> {
    return this.http.post<PlanInfo>(`${API}/billing/channel`, { channel }, { headers: this.headers });
  }
}
