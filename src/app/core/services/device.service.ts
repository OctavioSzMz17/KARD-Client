import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { LoginResponse } from '../models/auth.models';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import {
  StoredDevice,
  activeDeviceToken,
  clearDevice,
  isExpired,
  readDevice,
  saveDevice,
} from '../device-logic';

const API = `${environment.apiUrl}/device-auth`;

export interface ChallengeCreated {
  challenge_id: string;
  verification_code: string;
  expires_at: string;
  expires_in: number;
}

export interface ChallengeInfo {
  kind: 'enroll' | 'unlock';
  device_label: string;
  ip_address: string | null;
  created_at: string;
  expires_at: string;
  device_name: string | null;
  requires_code: boolean;
}

export interface ApproveBody {
  device_name?: string;
  code?: string;
  open_float?: string;
}

export interface ApproveResult {
  status: string;
  cash_opened: boolean;
}

export interface ClaimResult {
  status: 'pending' | 'approved' | 'denied';
  device_token?: string | null;
  device_name?: string | null;
  expires_at?: string | null;
  login?: LoginResponse | null;
}

export interface AuthorizedDevice {
  device_id: string;
  name: string;
  authorized_by: string | null;
  user_agent_label: string;
  created_at: string;
  expires_at: string;
  last_seen_at: string | null;
}

/**
 * Equipos autorizados (cajas registradoras) y acceso por QR.
 *
 * El token del equipo vive solo en este navegador. Lo manda un interceptor en
 * cada petición a la API; aquí solo se guarda, se consulta y se olvida.
 */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  /** El equipo guardado en este navegador (null si no hay). La señal mueve la pantalla al cambiar. */
  readonly device = signal<StoredDevice | null>(readDevice());

  /** ¿Este navegador es una caja autorizada que todavía no vence? */
  isAuthorized(): boolean {
    const d = this.device();
    return !!d && !isExpired(d.expires_at);
  }

  token(): string | null {
    return activeDeviceToken();
  }

  /** Guarda el equipo que acaba de autorizarse. */
  remember(device: StoredDevice): void {
    saveDevice(device);
    this.device.set(device);
  }

  /** Olvida el equipo: venció, lo retiraron o se cerró la caja. */
  forget(): void {
    clearDevice();
    this.device.set(null);
  }

  private get userHeaders(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  // ── La computadora (sin sesión) ───────────────────────
  createEnrollChallenge(secretHash: string): Observable<ChallengeCreated> {
    return this.http.post<ChallengeCreated>(`${API}/enroll-challenges`, { secret_hash: secretHash });
  }

  /** Lleva el token del equipo (lo pone el interceptor). */
  createUnlockChallenge(secretHash: string): Observable<ChallengeCreated> {
    return this.http.post<ChallengeCreated>(`${API}/unlock-challenges`, { secret_hash: secretHash });
  }

  claim(challengeId: string, secret: string): Observable<ClaimResult> {
    return this.http.post<ClaimResult>(`${API}/challenges/${challengeId}/claim`, { secret });
  }

  loginOnDevice(identifier: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API}/login`, { identifier, password });
  }

  /** ¿Sigue autorizado este equipo según el servidor? Falla con 403 si no. */
  verify(): Observable<AuthorizedDevice> {
    return this.http.get<AuthorizedDevice>(`${API}/current`);
  }

  /**
   * Cerrar sesión en la caja: ya nadie la opera y su ticket se vacía. Va ANTES de borrar la
   * sesión, porque el servidor necesita saber quién es.
   */
  release(): Observable<void> {
    return this.http.post<void>(`${API}/release`, null, { headers: this.userHeaders });
  }

  // ── El celular (con sesión de una persona) ────────────
  challengeInfo(id: string): Observable<ChallengeInfo> {
    return this.http.get<ChallengeInfo>(`${API}/challenges/${id}`, { headers: this.userHeaders });
  }

  approve(id: string, body: ApproveBody): Observable<ApproveResult> {
    return this.http.post<ApproveResult>(`${API}/challenges/${id}/approve`, body, { headers: this.userHeaders });
  }

  // ── La gerencia ───────────────────────────────────────
  list(): Observable<{ items: AuthorizedDevice[] }> {
    return this.http.get<{ items: AuthorizedDevice[] }>(`${API}/devices`, { headers: this.userHeaders });
  }

  revoke(id: string): Observable<void> {
    return this.http.delete<void>(`${API}/devices/${id}`, { headers: this.userHeaders });
  }

  /** Guarda el equipo que entregó el servidor al aprobar el QR. */
  acceptClaim(result: ClaimResult): void {
    if (result.device_token && result.expires_at) {
      this.remember({ token: result.device_token, name: result.device_name ?? 'Caja', expires_at: result.expires_at });
    }
  }
}

/** Para `tap` en quien guarde el resultado de un reclamo. */
export function storeDevice(service: DeviceService) {
  return tap<ClaimResult>(r => service.acceptClaim(r));
}
