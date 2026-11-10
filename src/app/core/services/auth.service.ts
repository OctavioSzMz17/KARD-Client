import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import {
  ConsumerLoginResponse, ConsumerRegisterRequest, LoginRequest, LoginResponse,
  TenantRegisterRequest, TenantRegisterResponse,
} from '../models/auth.models';
import { environment } from '../../../environments/environment';
import { PERM, Permission, fallbackPermissions, positionLabel } from '../permissions';

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
  /** Puesto, nombre y permisos: los manda el servidor. Una sesión vieja no los trae. */
  position?: string;
  position_label?: string;
  full_name?: string | null;
  employee_code?: string | null;
  permissions?: string[];
}

/** Respuesta de GET /auth/me. */
export interface MeResponse {
  user_id: string;
  tenant_id: string;
  business_type: UserSession['business_type'];
  role: string;
  email: string;
  position: string;
  position_label: string;
  full_name: string | null;
  employee_code: string | null;
  permissions: string[];
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

  /**
   * La sesión de negocio como señal: la pantalla se actualiza sola cuando
   * cambia el puesto o los permisos (por ejemplo, tras consultar `/auth/me`).
   */
  readonly profile = signal<UserSession | null>(this.getSession());

  login(data: LoginRequest): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${API_BASE}/auth/login`, data).pipe(
      tap(res => this.saveBusinessSession(res))
    );
  }

  loginConsumer(data: LoginRequest): Observable<ConsumerLoginResponse> {
    return this.http.post<ConsumerLoginResponse>(`${API_BASE}/consumers/login`, data).pipe(
      tap(res => this.saveConsumerSession(res))
    );
  }

  /**
   * Auto-registro de un negocio: crea el negocio y a su primer administrador
   * y devuelve el JWT, así que queda con la sesión iniciada.
   *
   * (Antes se llamaba a `/saasadmin/tenants`, que es solo para el
   * administrador de la plataforma y rechazaba a cualquier otro.)
   */
  registerTenant(data: TenantRegisterRequest): Observable<TenantRegisterResponse> {
    return this.http.post<TenantRegisterResponse>(`${API_BASE}/auth/register-tenant`, data).pipe(
      tap(res => this.saveBusinessSession(res))
    );
  }

  /** Registro de un cliente; igual que el negocio, queda con la sesión iniciada. */
  registerConsumer(data: ConsumerRegisterRequest): Observable<ConsumerLoginResponse> {
    return this.http.post<ConsumerLoginResponse>(`${API_BASE}/consumers/register`, data).pipe(
      tap(res => this.saveConsumerSession(res))
    );
  }

  /**
   * Pide el enlace para crear una contraseña nueva. El servidor contesta lo mismo exista o no el
   * correo (no revela quién está registrado), así que aquí tampoco hay forma de saberlo.
   */
  forgotPassword(email: string, audience: 'negocio' | 'cliente'): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${API_BASE}/auth/forgot-password`, { email, audience });
  }

  /** Cambia la contraseña con el enlace que llegó por correo. No inicia sesión: la persona entra con la nueva. */
  resetPassword(token: string, password: string): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(`${API_BASE}/auth/reset-password`, { token, password });
  }

  /** Abre la sesión con la respuesta de un inicio de sesión por otra vía (QR o código de empleado en una caja). */
  startBusinessSession(res: LoginResponse): void {
    this.saveBusinessSession(res);
  }

  private saveBusinessSession(res: LoginResponse | TenantRegisterResponse): void {
    localStorage.setItem(TOKEN_KEY, res.access_token);
    const session = {
      kind: 'b2b',
      user_id: res.user_id,
      tenant_id: res.tenant_id,
      role: res.role,
      business_type: res.business_type as UserSession['business_type'],
      position: res.position,
      position_label: res.position_label,
      full_name: res.full_name,
      employee_code: res.employee_code,
      permissions: res.permissions,
    } satisfies UserSession;
    localStorage.setItem(USER_KEY, JSON.stringify(session));
    this.profile.set(session);
  }

  /**
   * Vuelve a leer quién soy y qué puedo hacer. La pantalla no se fía de lo que
   * guardó al iniciar sesión: si cambiaron su puesto o la dieron de baja, se
   * entera aquí. Una baja devuelve 401 y quien llama decide cerrar la sesión.
   */
  refreshProfile(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${API_BASE}/auth/me`, { headers: this.getAuthHeaders() }).pipe(
      tap(me => {
        const session: UserSession = {
          kind: 'b2b',
          user_id: me.user_id,
          tenant_id: me.tenant_id,
          role: me.role,
          business_type: me.business_type,
          position: me.position,
          position_label: me.position_label,
          full_name: me.full_name,
          employee_code: me.employee_code,
          permissions: me.permissions,
        };
        localStorage.setItem(USER_KEY, JSON.stringify(session));
        this.profile.set(session);
      }),
    );
  }

  /**
   * ¿Puede la sesión actual hacer esto? Solo para mostrar u ocultar: el
   * servidor lo vuelve a comprobar en cada petición.
   */
  can(permission: Permission): boolean {
    const p = this.profile();
    if (!p) return false;
    return (p.permissions ?? fallbackPermissions(p.role)).includes(permission);
  }

  /**
   * A dónde mandar a esta sesión cuando no puede entrar adonde pidió: la
   * primera pantalla que sí le corresponde. Un empleado cae en Cobrar.
   */
  homeRoute(): string {
    if (this.can(PERM.dashboardView)) return '/dashboard';
    if (this.can(PERM.posSell)) return '/dashboard/cobrar';
    if (this.can(PERM.devicesUnlock)) return '/dashboard/escanear';
    if (this.can(PERM.productsRead)) return '/dashboard/products';
    return '/login';
  }

  /**
   * Cierra la sesión de la persona pero NO el equipo: la caja sigue autorizada
   * y vuelve a su pantalla de entrada para que entre la siguiente persona.
   */
  lock(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.profile.set(null);
    this.router.navigate(['/caja-registradora']);
  }

  /** Nombre para mostrar: el nombre de la persona o, si no lo tiene, su puesto. */
  displayName(): string {
    const p = this.profile();
    return p?.full_name || positionLabel(p?.position) || 'Equipo';
  }

  private saveConsumerSession(res: ConsumerLoginResponse): void {
    localStorage.setItem(TOKEN_KEY, res.access_token);
    localStorage.setItem(USER_KEY, JSON.stringify({
      kind: 'consumer',
      consumer_id: res.consumer_id
    } satisfies ConsumerSession));
    this.profile.set(null);
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.profile.set(null);
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
