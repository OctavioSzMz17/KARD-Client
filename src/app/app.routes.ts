import { Routes } from '@angular/router';
import { authGuard, consumerGuard } from './core/guards/auth.guard';

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
    loadComponent: () => import('./consumer/storefront/storefront.component').then(m => m.StorefrontComponent)
  },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./dashboard/layout/dashboard-layout.component').then(m => m.DashboardLayoutComponent),
    children: [
      { path: '', loadComponent: () => import('./dashboard/home/home.component').then(m => m.HomeComponent) },
      { path: 'products',  loadComponent: () => import('./dashboard/products/products.component').then(m => m.ProductsComponent) },
      { path: 'inventory', loadComponent: () => import('./dashboard/inventory/inventory.component').then(m => m.InventoryComponent) }
    ]
  },
  { path: '**', redirectTo: '/login' }
];
