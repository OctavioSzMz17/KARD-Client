import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ProductStore } from '../../core/store/product.store';

/** Lo que cada ruta del panel declara en su `data` para vestir la barra superior. */
interface PageInfo {
  title: string;
  subtitle: string;
  /** Vista ya rediseñada al estilo oscuro. Las demás se asientan sobre un lienzo claro. */
  dark: boolean;
}

const BUSINESS_LABEL: Record<string, string> = {
  restaurant: 'Restaurante',
  optician: 'Óptica',
  platform: 'Plataforma',
};

const ROLE_LABEL: Record<string, string> = {
  business_admin: 'Administrador',
  business_staff: 'Equipo',
  platform_admin: 'Plataforma',
};

@Component({
  selector: 'app-dashboard-layout',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, NgTemplateOutlet],
  templateUrl: './dashboard-layout.component.html',
  styleUrl: './dashboard-layout.component.scss'
})
export class DashboardLayoutComponent {
  private auth   = inject(AuthService);
  private store  = inject(ProductStore);
  private router = inject(Router);

  private session = this.auth.getSession();

  navItems = [
    { label: 'Dashboard', icon: 'home', route: '/dashboard', exact: true, enabled: true },
    { label: 'Cobrar', icon: 'cart', route: '/dashboard/cobrar', exact: false, enabled: true },
    { label: 'Caja', icon: 'cash', route: '/dashboard/caja', exact: false, enabled: true },
    { label: 'Products', icon: 'box', route: '/dashboard/products', exact: false, enabled: true },
    { label: 'Inventory', icon: 'archive', route: '/dashboard/inventory', exact: false, enabled: true },
    { label: 'Ventas', icon: 'chart', route: '/dashboard/sales', exact: false, enabled: true },
    { label: 'Personalización', icon: 'palette', route: '/dashboard/branding', exact: false, enabled: true },
    { label: 'Suscripción', icon: 'card', route: '/dashboard/suscripcion', exact: false, enabled: true },
    { label: 'Customers', icon: 'users', route: '/dashboard/customers', exact: false, enabled: false },
    { label: 'Audit Log', icon: 'log', route: '/dashboard/audit', exact: false, enabled: false },
  ];

  /** Menú lateral abierto (solo cuenta en pantallas angostas, donde es un cajón). */
  menuOpen = signal(false);

  toggleMenu(): void { this.menuOpen.update(v => !v); }
  closeMenu(): void { this.menuOpen.set(false); }

  @HostListener('document:keydown.escape')
  onEscape(): void { this.closeMenu(); }

  /** `data` de la ruta hija activa, releída en cada navegación. */
  private routeData = toSignal(
    this.router.events.pipe(
      filter(e => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        // Elegir una sección en el cajón del celular también lo cierra.
        this.menuOpen.set(false);
        let route = this.router.routerState.snapshot.root;
        while (route.firstChild) route = route.firstChild;
        return route.data;
      }),
    ),
    { initialValue: {} as Record<string, unknown> },
  );

  page = computed<PageInfo>(() => {
    const d = this.routeData();
    return {
      title: (d['title'] as string) ?? '',
      subtitle: (d['subtitle'] as string) ?? '',
      dark: d['dark'] === true,
    };
  });

  businessLabel = computed(() => BUSINESS_LABEL[this.session?.business_type ?? ''] ?? 'Negocio');
  roleLabel = computed(() => ROLE_LABEL[this.session?.role ?? ''] ?? (this.session?.role ?? 'Equipo'));

  logout(): void {
    this.store.clear();   // wipe tenant data before navigating away
    this.auth.logout();
  }
}
