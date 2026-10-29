import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

/**
 * Modos de entrega que el negocio ofrece.
 *
 * La tienda pública solo muestra los que estén en `true`, y el checkout del
 * backend rechaza cualquier otro: un negocio no puede recibir un pedido de
 * envío si no reparte.
 */
export interface Fulfillment {
  /** Consumo en el local — pedido desde la mesa. Solo donde hay local. */
  dine_in: boolean;
  /** Se lo lleva en el momento. */
  takeaway: boolean;
  /** Lo recoge más tarde. */
  pickup: boolean;
  /** Envío a domicilio. Exige logística, por eso nace apagado. */
  delivery: boolean;

  /** Tarifa plana de envío. Solo aplica cuando `delivery` está activo. */
  shipping_flat_fee: number;
  /** Monto a partir del cual el envío no se cobra. `null` = nunca es gratis. */
  free_shipping_above: number | null;
  /** Nota visible para el cliente (zonas de reparto, horarios, etc.). */
  delivery_notes: string | null;
}

/**
 * Configuración de entregas del negocio — endpoints B2B.
 * Requieren JWT de negocio; el tenant sale del token.
 * El PUT es reemplazo TOTAL, igual que branding y profile.
 */
@Injectable({ providedIn: 'root' })
export class FulfillmentService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  get(): Observable<Fulfillment> {
    return this.http.get<Fulfillment>(`${API}/settings/fulfillment`, { headers: this.headers });
  }

  update(value: Fulfillment): Observable<Fulfillment> {
    return this.http.put<Fulfillment>(`${API}/settings/fulfillment`, value, { headers: this.headers });
  }
}
