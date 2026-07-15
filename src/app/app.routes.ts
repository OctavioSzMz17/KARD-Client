import { Routes } from '@angular/router';
import { authGuard, consumerGuard } from './core/guards/auth.guard';
import { StorefrontStore } from './core/store/storefront.store';

export const routes: Routes = [
  { path: '', redirectTo: '/login', pathMatch: 'full' },
  {
    path: 'login',
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: 'register',
    loadComponent: () => import('./auth/register/register.component').then(m => m.RegisterComponent)
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
      { path: 'branding',  loadComponent: () => import('./dashboard/personalization/personalization.component').then(m => m.PersonalizationComponent) }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
