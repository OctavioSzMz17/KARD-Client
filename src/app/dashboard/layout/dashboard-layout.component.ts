import { Component, HostListener, OnInit, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { filter, map, startWith, timeout } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { ProductStore } from '../../core/store/product.store';
import { PERM, Permission, positionLabel } from '../../core/permissions';
import { DeviceService } from '../../core/services/device.service';
import { BRAND_NAME } from '../../shared/brand';

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
export class DashboardLayoutComponent implements OnInit {
  /** Nombre del producto en pantalla (ver shared/brand.ts). */
  readonly brand = BRAND_NAME;
  private auth   = inject(AuthService);
  private store  = inject(ProductStore);
  private router = inject(Router);
  private device = inject(DeviceService);

  /**
   * El menú completo; cada entrada declara el permiso que pide. Lo que la
   * sesión no puede hacer no se muestra (el servidor lo impide de todos modos).
   */
  private navItems: { label: string; icon: string; route: string; exact: boolean; enabled: boolean; perm: Permission }[] = [
    { label: 'Inicio', icon: 'home', route: '/dashboard', exact: true, enabled: true, perm: PERM.dashboardView },
    { label: 'Cobrar', icon: 'cart', route: '/dashboard/cobrar', exact: false, enabled: true, perm: PERM.posSell },
    { label: 'Caja', icon: 'cash', route: '/dashboard/caja', exact: false, enabled: true, perm: PERM.cashManage },
    { label: 'Escanear', icon: 'camera', route: '/dashboard/escanear', exact: false, enabled: true, perm: PERM.devicesUnlock },
    { label: 'Productos', icon: 'box', route: '/dashboard/products', exact: false, enabled: true, perm: PERM.productsRead },
    { label: 'Inventario', icon: 'archive', route: '/dashboard/inventory', exact: false, enabled: true, perm: PERM.inventoryAdjust },
    { label: 'Ventas', icon: 'chart', route: '/dashboard/sales', exact: false, enabled: true, perm: PERM.salesRead },
    { label: 'Equipo', icon: 'users', route: '/dashboard/equipo', exact: false, enabled: true, perm: PERM.teamManage },
    { label: 'Personalización', icon: 'palette', route: '/dashboard/branding', exact: false, enabled: true, perm: PERM.settingsManage },
    { label: 'Suscripción', icon: 'card', route: '/dashboard/suscripcion', exact: false, enabled: true, perm: PERM.billingManage },
  ];

  /** Solo las entradas que la sesión actual puede usar; se actualiza sola si cambia su puesto. */
  readonly visibleNav = computed(() => this.navItems.filter(i => this.auth.can(i.perm)));


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

  /** Quién está en esta pantalla: su nombre y su puesto (o, sin nombre, el giro del negocio y su puesto). */
  readonly chipLabel = computed(() => {
    const p = this.auth.profile();
    const puesto = p?.position_label || positionLabel(p?.position) || ROLE_LABEL[p?.role ?? ''] || 'Equipo';
    return p?.full_name ? `${p.full_name} · ${puesto}` : `${BUSINESS_LABEL[p?.business_type ?? ''] ?? 'Negocio'} · ${puesto}`;
  });

  ngOnInit(): void {
    // No se fía de lo que se guardó al iniciar sesión: pregunta quién es y qué puede hacer ahora.
    // Una baja devuelve 401: se cierra la sesión.
    this.auth.refreshProfile().subscribe({
      error: err => { if (err?.status === 401) this.logout(); },
    });

    // Si este navegador cree ser una caja, se confirma con el servidor: pudieron retirarla
    // o cerrarse la caja del día. Una caja que ya no vale se olvida; la sesión de quien está
    // dentro sigue siendo suya y no se toca.
    if (this.device.device()) {
      this.device.verify().subscribe({
        error: err => { if (err?.status === 403) this.device.forget(); },
      });
    }
  }

  /** Este navegador es una caja registradora autorizada: al salir vuelve a su pantalla de entrada. */
  readonly isRegister = computed(() => !!this.device.device() && this.device.isAuthorized());

  logout(): void {
    this.store.clear();   // wipe tenant data before navigating away
    // En una caja el equipo sigue autorizado: se cierra la sesión de la persona y la caja queda
    // lista para la siguiente (sin operador y con el ticket vacío). En cualquier otro navegador,
    // se vuelve al inicio de sesión.
    if (this.isRegister()) return this.releaseThenLock();
    this.auth.logout();
  }

  /**
   * Avisa al servidor que la caja quedó libre y después cierra la sesión. Si no hay conexión no
   * se espera de más: la sesión se cierra igual, y el ticket se vaciará cuando entre la siguiente persona.
   */
  private releaseThenLock(): void {
    let locked = false;
    const lock = () => { if (!locked) { locked = true; this.auth.lock(); } };
    this.device.release().pipe(timeout(3000)).subscribe({ next: lock, complete: lock, error: lock });
  }
}
