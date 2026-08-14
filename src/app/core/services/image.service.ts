import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';

const API = environment.apiUrl;

export interface ProductImage {
  image_id: string;
  owner_type: string;
  owner_id: string;
  url: string;
  alt_text?: string;
  sort_order: number;
  created_at: string;
}

export interface AddImageRequest {
  url: string;
  alt_text?: string;
  sort_order?: number;
}

@Injectable({ providedIn: 'root' })
export class ImageService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  list(productId: string): Observable<ProductImage[]> {
    return this.http.get<ProductImage[]>(`${API}/products/${productId}/images`, { headers: this.headers });
  }

  add(productId: string, body: AddImageRequest): Observable<ProductImage> {
    return this.http.post<ProductImage>(`${API}/products/${productId}/images`, body, { headers: this.headers });
  }

  update(productId: string, imageId: string, body: Partial<AddImageRequest> & { sort_order?: number }): Observable<ProductImage> {
    return this.http.patch<ProductImage>(`${API}/products/${productId}/images/${imageId}`, body, { headers: this.headers });
  }

  remove(productId: string, imageId: string): Observable<void> {
    return this.http.delete<void>(`${API}/products/${productId}/images/${imageId}`, { headers: this.headers });
  }
}
