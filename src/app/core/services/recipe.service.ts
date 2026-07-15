import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from './auth.service';

const API = 'http://localhost:8000/api/v1';

/** Un ingrediente de la receta de un platillo (final). */
export interface RecipeItem {
  insumo_id:   string;
  insumo_name: string;
  quantity:    number;   // entero > 0: unidades de stock del insumo por unidad vendida
  unit:        string;
}

export interface Recipe {
  final_product_id:   string;
  final_product_name: string;
  items:              RecipeItem[];
}

/**
 * Recetas (Bill of Materials) de productos finales — endpoints B2B.
 * Requieren JWT de negocio. La receta se usa en el checkout para el
 * descuento en cascada de insumos.
 */
@Injectable({ providedIn: 'root' })
export class RecipeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  get(productId: string): Observable<Recipe> {
    return this.http.get<Recipe>(`${API}/products/${productId}/recipe`, { headers: this.headers });
  }

  /** Agrega o actualiza (upsert) un ingrediente. Devuelve la receta completa. */
  addItem(productId: string, insumoProductId: string, quantity: number): Observable<Recipe> {
    return this.http.post<Recipe>(
      `${API}/products/${productId}/recipe/items`,
      { insumo_product_id: insumoProductId, quantity },
      { headers: this.headers }
    );
  }

  removeItem(productId: string, insumoId: string): Observable<Recipe> {
    return this.http.delete<Recipe>(
      `${API}/products/${productId}/recipe/items/${insumoId}`,
      { headers: this.headers }
    );
  }
}
