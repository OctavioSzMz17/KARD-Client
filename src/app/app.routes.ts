import { Routes, UrlMatcher } from '@angular/router';
import { authGuard, consumerGuard, permissionGuard } from './core/guards/auth.guard';
import { PERM } from './core/permissions';
import { StorefrontStore } from './core/store/storefront.store';
import { BRAND_NAME } from './shared/brand';

/** Casa con /login y /register y entrega cuál de las dos fue como parámetro `mode`. */
export const authMatcher: UrlMatcher = (segments) =>
  segments.length === 1 && (segments[0].path === 'login' || segments[0].path === 'register')
    ? { consumed: segments, posParams: { mode: segments[0] } }
    : null;

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    // /login y /register son la misma página (un interruptor Cliente/Negocio):
    // comparten configuración para que Angular conserve el componente al pasar
    // de una a otra, en vez de reconstruirlo.
    matcher: authMatcher,
    loadComponent: () => import('./auth/auth-page/auth-page.component').then(m => m.AuthPageComponent)
  },
  {
    // Recuperar la contraseña: pedir el enlace (/recuperar) y usarlo (/restablecer). Son públicas:
    // las usa quien no puede iniciar sesión. El enlace del correo trae el token en el `#`.
    path: 'recuperar',
    data: { mode: 'ask' },
    loadComponent: () => import('./auth/password-recovery/password-recovery.component').then(m => m.PasswordRecoveryComponent)
  },
  {
    path: 'restablecer',
    data: { mode: 'reset' },
    loadComponent: () => import('./auth/password-recovery/password-recovery.component').then(m => m.PasswordRecoveryComponent)
  },
  {
    path: 'explore',
    canActivate: [consumerGuard],
    loadComponent: () => import('./consumer/explore/explore.component').then(m => m.ExploreComponent)
  },
  {
    path: 's/:slug',
    canActivate: [consumerGuard],
    // El store se provee acá: layout, landing y catálogo comparten la misma
    // instancia (info del negocio, tema y carrito) y se destruye al salir.
    providers: [StorefrontStore],
    loadComponent: () => import('./consumer/storefront/storefront-layout.component').then(m => m.StorefrontLayoutComponent),
    children: [
      { path: '', loadComponent: () => import('./consumer/storefront/landing/storefront-landing.component').then(m => m.StorefrontLandingComponent) },
      { path: 'productos', loadComponent: () => import('./consumer/storefront/catalog/storefront-catalog.component').then(m => m.StorefrontCatalogComponent) }
    ]
  },
  {
    // La pantalla de la caja registradora: autorizar este equipo y desbloquearlo. No pide
    // sesión: la usa una computadora que aún no tiene (la seguridad está en el servidor).
    path: 'caja-registradora',
    loadComponent: () => import('./register-mode/register-mode.component').then(m => m.RegisterModeComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/layout/dashboard-layout.component').then(m => m.DashboardLayoutComponent),
    children: [
      {
        path: '',
        canActivate: [permissionGuard(PERM.dashboardView)],
        data: { title: 'Inicio', subtitle: 'Resumen de tu inventario y de lo que pasa en tu negocio.', dark: true },
        loadComponent: () => import('./dashboard/home/home.component').then(m => m.HomeComponent)
      },
      {
        // Escanear: aprobar un QR desde el celular (autorizar una caja o abrir sesión en ella).
        path: 'escanear',
        canActivate: [permissionGuard(PERM.devicesUnlock)],
        data: { title: 'Escanear', subtitle: 'Autoriza una caja o entra en ella con tu cuenta.', dark: true },
        loadComponent: () => import('./dashboard/scan-access/scan-access.component').then(m => m.ScanAccessComponent)
      },
      {
        // Dirección que lleva el QR: abre directo la aprobación (la lee la cámara normal del celular).
        path: 'aprobar',
        canActivate: [permissionGuard(PERM.devicesUnlock)],
        data: { title: 'Escanear', subtitle: 'Autoriza una caja o entra en ella con tu cuenta.', dark: true },
        loadComponent: () => import('./dashboard/scan-access/scan-access.component').then(m => m.ScanAccessComponent)
      },
      {
        // Equipo: registrar y administrar a las personas del negocio.
        path: 'equipo',
        canActivate: [permissionGuard(PERM.teamManage)],
        data: { title: 'Equipo', subtitle: 'Las personas que trabajan en tu negocio y lo que cada una puede hacer.', dark: true },
        loadComponent: () => import('./dashboard/team/team.component').then(m => m.TeamComponent)
      },
      {
        // `data` viste la barra superior del panel; `dark` marca las vistas ya rediseñadas.
        path: 'cobrar',
        canActivate: [permissionGuard(PERM.posSell)],
        data: { title: 'Cobrar', subtitle: 'Arma el ticket y cobra en el mostrador.', dark: true },
        loadComponent: () => import('./dashboard/pos/pos.component').then(m => m.PosComponent)
      },
      {
        path: 'caja',
        canActivate: [permissionGuard(PERM.cashManage)],
        data: { title: 'Caja', subtitle: 'Abre el turno, sigue cómo va y ciérralo con el corte.', dark: true },
        loadComponent: () => import('./dashboard/cash/cash.component').then(m => m.CashComponent)
      },
      { path: 'products',  canActivate: [permissionGuard(PERM.productsRead)], loadComponent: () => import('./dashboard/products/products.component').then(m => m.ProductsComponent) },
      { path: 'inventory', canActivate: [permissionGuard(PERM.inventoryAdjust)], loadComponent: () => import('./dashboard/inventory/inventory.component').then(m => m.InventoryComponent) },
      { path: 'sales',     canActivate: [permissionGuard(PERM.salesRead)], loadComponent: () => import('./dashboard/sales/sales.component').then(m => m.SalesComponent) },
      { path: 'branding',  canActivate: [permissionGuard(PERM.settingsManage)], loadComponent: () => import('./dashboard/personalization/personalization.component').then(m => m.PersonalizationComponent) },
      {
        path: 'suscripcion',
        canActivate: [permissionGuard(PERM.billingManage)],
        data: { title: 'Suscripción', subtitle: `Tu plan de ${BRAND_NAME} y lo que incluye.`, dark: true },
        loadComponent: () => import('./dashboard/subscription/subscription.component').then(m => m.SubscriptionComponent)
      }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
