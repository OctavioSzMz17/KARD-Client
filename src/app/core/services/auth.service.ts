import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { ConsumerLoginResponse, LoginRequest, LoginResponse, RegisterRequest, RegisterResponse } from '../models/auth.models';
import { environment } from '../../../environments/environment';

const API_BASE = environment.apiUrl;
const TOKEN_KEY = 'kard_token';
const USER_KEY = 'kard_user';

/** Sesión B2B (dueño/empleado del negocio) — token de /auth/login */
export interface UserSession {
  kind?: 'b2b';          // sesiones viejas en localStorage no traen kind
  user_id: string;
  tenant_id: string;
  role: string;
  business_type: 'restaurant' | 'optician' | 'platform';
}

/** Sesión consumer (cliente B2C) — token de /consumers/login */
export interface ConsumerSession {
  kind: 'consumer';
  consumer_id: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  private router = inject(Router);

  login(data: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE}/auth/login`, data).pipe(
      tap(res => {
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify({
          kind: 'b2b',
          user_id: res.user_id,
          tenant_id: res.tenant_id,
          role: res.role,
          business_type: res.business_type as UserSession['business_type']
        } satisfies UserSession));
      })
    );
  }

  loginConsumer(data: LoginRequest): Observable<ConsumerLoginResponse> {
    return this.http.post<ConsumerLoginResponse>(`${API_BASE}/consumers/login`, data).pipe(
      tap(res => {
        localStorage.setItem(TOKEN_KEY, res.access_token);
        localStorage.setItem(USER_KEY, JSON.stringify({
          kind: 'consumer',
          consumer_id: res.consumer_id
        } satisfies ConsumerSession));
      })
    );
  }

  register(data: RegisterRequest): Observable<RegisterResponse> {
    return this.http.post<RegisterResponse>(`${API_BASE}/saasadmin/tenants`, data);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.router.navigate(['/login']);
  }

  getToken(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  /** Sesión B2B (negocio). Devuelve null si no hay sesión o si la sesión es de consumer. */
  getSession(): UserSession | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session.kind === 'consumer' ? null : session;
  }

  /** Sesión consumer (cliente). Devuelve null si no hay sesión o si es B2B. */
  getConsumerSession(): ConsumerSession | null {
    const raw = localStorage.getItem(USER_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    return session.kind === 'consumer' ? session : null;
  }

  isConsumer(): boolean {
    return !!this.getConsumerSession();
  }

  isLoggedIn(): boolean {
    return !!this.getToken();
  }

  getAuthHeaders(): { Authorization: string } | {} {
    const token = this.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }
}
