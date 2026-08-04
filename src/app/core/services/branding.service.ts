import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

const API = 'http://localhost:8000/api/v1';

export interface BrandingTheme {
  primary: string | null;   // hex "#RRGGBB"
  accent:  string | null;   // hex "#RRGGBB"
}

export interface Branding {
  logo_url:   string | null;
  banner_url: string | null;
  theme:      BrandingTheme;   // el backend siempre devuelve el objeto (con nulls)
}

/**
 * Marca del negocio (logo, banner, tema) — endpoints B2B.
 * Requieren JWT de negocio. El tenant sale del token.
 * El PUT es reemplazo TOTAL: lo que no se manda queda en null.
 */
@Injectable({ providedIn: 'root' })
export class BrandingService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  get(): Observable<Branding> {
    return this.http.get<Branding>(`${API}/settings/branding`, { headers: this.headers });
  }

  update(branding: Branding): Observable<Branding> {
    return this.http.put<Branding>(`${API}/settings/branding`, branding, { headers: this.headers });
  }
}
