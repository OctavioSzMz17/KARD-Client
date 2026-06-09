import { Component, inject, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-dashboard-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.scss'
})
export class DashboardLayoutComponent {
  auth = inject(AuthService);

  navItems = [
    { label: 'Dashboard', icon: 'home', route: '/dashboard', exact: true, enabled: true },
    { label: 'Products', icon: 'box', route: '/dashboard/products', exact: false, enabled: true },
    { label: 'Inventory', icon: 'archive', route: '/dashboard/inventory', exact: false, enabled: false },
    { label: 'Customers', icon: 'users', route: '/dashboard/customers', exact: false, enabled: false },
    { label: 'Audit Log', icon: 'log', route: '/dashboard/audit', exact: false, enabled: false },
  ];
}
