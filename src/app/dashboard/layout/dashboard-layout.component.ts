import { Component, inject } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { ProductStore } from '../../core/store/product.store';

@Component({
  selector: 'app-dashboard-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.scss'
})
export class DashboardLayoutComponent {
  private auth  = inject(AuthService);
  private store = inject(ProductStore);

  navItems = [
    { label: 'Dashboard', icon: 'home', route: '/dashboard', exact: true, enabled: true },
    { label: 'Products', icon: 'box', route: '/dashboard/products', exact: false, enabled: true },
    { label: 'Inventory', icon: 'archive', route: '/dashboard/inventory', exact: false, enabled: true },
    { label: 'Ventas', icon: 'chart', route: '/dashboard/sales', exact: false, enabled: true },
    { label: 'Personalización', icon: 'palette', route: '/dashboard/branding', exact: false, enabled: true },
    { label: 'Customers', icon: 'users', route: '/dashboard/customers', exact: false, enabled: false },
    { label: 'Audit Log', icon: 'log', route: '/dashboard/audit', exact: false, enabled: false },
  ];

  logout(): void {
    this.store.clear();   // wipe tenant data before navigating away
    this.auth.logout();
  }
}
