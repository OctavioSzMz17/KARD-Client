import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export interface TeamMember {
  user_id: string;
  full_name: string | null;
  email: string;
  employee_code: string | null;
  position: string;
  position_label: string;
  is_active: boolean;
  last_login: string | null;
  /** Quien consulta puede modificar a esta persona (está por debajo de él en la jerarquía). */
  can_manage: boolean;
}

export interface PositionOption {
  value: string;
  label: string;
}

export interface TeamList {
  items: TeamMember[];
  /** Puestos que quien consulta puede dar a otros: la pantalla ofrece solo estos. */
  assignable_positions: PositionOption[];
}

export interface NewMember {
  full_name: string;
  email: string;
  password: string;
  position: string;
}

export interface MemberChanges {
  full_name?: string;
  position?: string;
  is_active?: boolean;
}

/**
 * Equipo del negocio — endpoints B2B que exigen `team:manage`. El servidor
 * decide a quién se puede registrar o modificar según la jerarquía; la
 * pantalla solo ofrece lo que él ya dijo que se puede.
 */
@Injectable({ providedIn: 'root' })
export class TeamService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  list(): Observable<TeamList> {
    return this.http.get<TeamList>(`${API}/team`, { headers: this.headers });
  }

  create(body: NewMember): Observable<TeamMember> {
    return this.http.post<TeamMember>(`${API}/team`, body, { headers: this.headers });
  }

  update(userId: string, changes: MemberChanges): Observable<TeamMember> {
    return this.http.patch<TeamMember>(`${API}/team/${userId}`, changes, { headers: this.headers });
  }

  resetPassword(userId: string, password: string): Observable<void> {
    return this.http.post<void>(`${API}/team/${userId}/password`, { password }, { headers: this.headers });
  }
}
