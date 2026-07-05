import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { StorefrontInfo, StorefrontProduct, StorefrontService } from '../../core/services/storefront.service';
import { Cart, CartService } from '../../core/services/cart.service';
import { Order, OrderService } from '../../core/services/order.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { ProductImage } from '../../core/services/image.service';

const PAGE_SIZE = 24;

// Tema por defecto (KARD) — se sobreescribe cuando el negocio tenga su config
const DEFAULT_THEME = {
  primary: '#5b6ef5',
  accent:  '#1e3a8a',
};

const CATEGORY_LABELS: Record<string, string> = {
  restaurant: 'Restaurante',
  optician:   'Óptica',
};

@Component({
  selector: 'app-storefront',
  templateUrl: './storefront.component.html',
  styleUrl: './storefront.component.scss'
})
export class StorefrontComponent implements OnInit {
  private auth       = inject(AuthService);
  private sf         = inject(StorefrontService);
  private cartSvc    = inject(CartService);
  private orderSvc   = inject(OrderService);
  private snack      = inject(SnackbarService);
  private route      = inject(ActivatedRoute);
  private router     = inject(Router);
  private destroyRef = inject(DestroyRef);

  slug = '';

  store           = signal<StorefrontInfo | null>(null);
  notFound        = signal(false);
  products        = signal<StorefrontProduct[]>([]);
  total           = signal(0);
  loadingStore    = signal(true);
  loadingProducts = signal(true);
  loadingMore     = signal(false);
  searchQuery     = signal('');
  private page    = 1;

  // ── Carrito ───────────────────────────────────────────
  cart         = signal<Cart | null>(null);
  cartOpen     = signal(false);
  cartBusy     = signal(false);       // operación de carrito en curso
  pendingAddId = signal<string | null>(null); // producto agregándose (spinner por card)
  placedOrder  = signal<Order | null>(null);  // pedido recién confirmado

  private search$ = new Subject<string>();

  /** CSS variables del tema — listas para la config del negocio. */
  themeVars = computed(() => {
    const theme = this.store()?.theme;
    return {
      '--sf-primary': theme?.primary ?? DEFAULT_THEME.primary,
      '--sf-accent':  theme?.accent  ?? DEFAULT_THEME.accent,
    };
  });

  hasMore = computed(() => this.products().length < this.total());

  ngOnInit(): void {
    this.slug = this.route.snapshot.paramMap.get('slug') ?? '';

    this.search$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(q => {
      this.searchQuery.set(q);
      this.fetchProducts(true);
    });

    this.sf.getStore(this.slug).subscribe({
      next: (info) => {
        this.store.set(info);
        this.loadingStore.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loadingStore.set(false);
        this.loadingProducts.set(false);
      }
    });

    this.fetchProducts(true);
    this.loadCart();
  }

  onSearch(e: Event): void {
    this.search$.next((e.target as HTMLInputElement).value.trim());
  }

  loadMore(): void {
    if (this.loadingMore() || !this.hasMore()) return;
    this.page += 1;
    this.loadingMore.set(true);
    this.sf.getProducts(this.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.products.update(items => [...items, ...res.items]);
          this.total.set(res.total);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false)
      });
  }

  private fetchProducts(reset: boolean): void {
    if (reset) {
      this.page = 1;
      this.loadingProducts.set(true);
    }
    this.sf.getProducts(this.slug, { search: this.searchQuery() || undefined, page: this.page, pageSize: PAGE_SIZE })
      .subscribe({
        next: (res) => {
          this.products.set(res.items);
          this.total.set(res.total);
          this.loadingProducts.set(false);
        },
        error: () => {
          this.products.set([]);
          this.total.set(0);
          this.loadingProducts.set(false);
        }
      });
  }

  // ── Carrito ───────────────────────────────────────────
  private loadCart(): void {
    this.cartSvc.get(this.slug).subscribe({
      next: (cart) => this.cart.set(cart),
      error: () => this.cart.set(null)   // sin token válido o Redis caído: sin carrito
    });
  }

  /** Cantidad actual de un producto en el carrito (para pintar el stepper en la card). */
  qtyInCart(productId: string): number {
    return this.cart()?.items.find(i => i.product_id === productId)?.quantity ?? 0;
  }

  addToCart(p: StorefrontProduct): void {
    this.setQuantity(p.product_id, this.qtyInCart(p.product_id) + 1);
  }

  changeQty(productId: string, delta: number): void {
    const next = this.qtyInCart(productId) + delta;
    this.setQuantity(productId, Math.max(0, next));
  }

  private setQuantity(productId: string, quantity: number): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.pendingAddId.set(productId);
    this.cartSvc.setItem(this.slug, productId, quantity).subscribe({
      next: (cart) => {
        this.cart.set(cart);
        this.cartBusy.set(false);
        this.pendingAddId.set(null);
      },
      error: (err: any) => {
        this.cartBusy.set(false);
        this.pendingAddId.set(null);
        this.snack.error(this.cartErrorMessage(err));
      }
    });
  }

  removeFromCart(productId: string): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.cartSvc.removeItem(this.slug, productId).subscribe({
      next: (cart) => { this.cart.set(cart); this.cartBusy.set(false); },
      error: (err: any) => { this.cartBusy.set(false); this.snack.error(this.cartErrorMessage(err)); }
    });
  }

  clearCart(): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.cartSvc.clear(this.slug).subscribe({
      next: () => {
        this.cart.update(c => c ? { ...c, items: [], total: '0.00', item_count: 0 } : c);
        this.cartBusy.set(false);
      },
      error: (err: any) => { this.cartBusy.set(false); this.snack.error(this.cartErrorMessage(err)); }
    });
  }

  openCart(): void  { this.placedOrder.set(null); this.cartOpen.set(true); }
  closeCart(): void { this.cartOpen.set(false); this.placedOrder.set(null); }

  confirmOrder(): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.orderSvc.create(this.slug).subscribe({
      next: (order) => {
        this.cartBusy.set(false);
        this.placedOrder.set(order);
        this.cart.update(c => c ? { ...c, items: [], total: '0.00', item_count: 0 } : c);
        this.snack.success('¡Pedido confirmado!');
      },
      error: (err: any) => {
        this.cartBusy.set(false);
        this.snack.error(err.error?.error ?? 'No se pudo confirmar el pedido.');
        // el stock pudo cambiar — refrescar carrito por si el backend lo modificó
        this.loadCart();
      }
    });
  }

  private cartErrorMessage(err: any): string {
    if (err.status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    if (err.status === 503) return 'El carrito no está disponible en este momento.';
    return err.error?.error ?? 'No se pudo actualizar el carrito.';
  }

  // ── Helpers de presentación ───────────────────────────
  typeLabel(): string {
    const type = this.store()?.business_type;
    return type ? (CATEGORY_LABELS[type] ?? type) : '';
  }

  storeInitial(): string {
    return this.store()?.business_name?.charAt(0)?.toUpperCase() ?? '?';
  }

  primaryImage(images: ProductImage[]): ProductImage | null {
    return images?.find(i => i.sort_order === 0) ?? images?.[0] ?? null;
  }

  /** Chips de metadata según el tipo de negocio. */
  metaChips(p: StorefrontProduct): string[] {
    const m = p.metadata ?? {};
    if (this.store()?.business_type === 'restaurant') {
      const chips: string[] = [];
      if (m['categoria'])              chips.push(String(m['categoria']).replace('_', ' '));
      if (m['tiempo_preparacion_min']) chips.push(`${m['tiempo_preparacion_min']} min`);
      if (m['picante'])                chips.push('🌶 picante');
      return chips;
    }
    if (this.store()?.business_type === 'optician') {
      const chips: string[] = [];
      if (m['material']) chips.push(m['material']);
      if (m['esfera'] !== undefined && m['cilindro'] !== undefined) chips.push(`${m['esfera']} / ${m['cilindro']}`);
      return chips;
    }
    return [];
  }

  backToExplore(): void {
    this.router.navigate(['/explore']);
  }

  logout(): void {
    this.auth.logout();
  }
}
