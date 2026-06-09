import { Component, inject } from '@angular/core';
import { AuthService } from '../core/services/auth.service';

@Component({
  selector: 'app-dashboard',
  template: `
    <div style="padding:40px; text-align:center;">
      <h1>Dashboard — Próximamente</h1>
      <p style="color:#666;">Estás autenticado correctamente.</p>
      <button (click)="auth.logout()" style="margin-top:16px; padding:10px 24px; cursor:pointer;">
        Cerrar sesión
      </button>
    </div>
  `
})
export class DashboardComponent {
  auth = inject(AuthService);
}
