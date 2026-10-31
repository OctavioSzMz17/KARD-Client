import { Routes, UrlMatcher } from '@angular/router';
import { authGuard, consumerGuard } from './core/guards/auth.guard';
import { StorefrontStore } from './core/store/storefront.store';

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
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/layout/dashboard-layout.component').then(m => m.DashboardLayoutComponent),
    children: [
      { path: '', loadComponent: () => import('./dashboard/home/home.component').then(m => m.HomeComponent) },
      { path: 'products',  loadComponent: () => import('./dashboard/products/products.component').then(m => m.ProductsComponent) },
      { path: 'inventory', loadComponent: () => import('./dashboard/inventory/inventory.component').then(m => m.InventoryComponent) },
      { path: 'sales',     loadComponent: () => import('./dashboard/sales/sales.component').then(m => m.SalesComponent) },
      { path: 'branding',  loadComponent: () => import('./dashboard/personalization/personalization.component').then(m => m.PersonalizationComponent) },
      { path: 'suscripcion', loadComponent: () => import('./dashboard/subscription/subscription.component').then(m => m.SubscriptionComponent) }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
