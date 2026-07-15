import { Injectable, computed, inject, signal } from '@angular/core';
import { StorefrontInfo, StorefrontService } from '../services/storefront.service';
import { Cart, CartService } from '../services/cart.service';
import { Order, OrderService, StockConflict } from '../services/order.service';
import { SnackbarService } from '../services/snackbar.service';

// Defaults de KARD cuando el negocio no definió tema
const DEFAULT_PRIMARY = '#5b6ef5';
const DEFAULT_ACCENT  = '#1e3a8a';

/**
 * Estado compartido de una tienda: info del negocio, tema y carrito.
 * Se provee a nivel de la ruta /s/:slug, así el layout y sus páginas hijas
 * (landing y catálogo) comparten la misma instancia, y se destruye al salir.
 */
@Injectable()
export class StorefrontStore {
  private sf       = inject(StorefrontService);
  private cartSvc  = inject(CartService);
  private orderSvc = inject(OrderService);
  private snack    = inject(SnackbarService);

  slug = '';

  // ── Negocio ───────────────────────────────────────────
  store        = signal<StorefrontInfo | null>(null);
  loadingStore = signal(true);
  notFound     = signal(false);

  // ── Carrito ───────────────────────────────────────────
  cart          = signal<Cart | null>(null);
  cartOpen      = signal(false);
  cartBusy      = signal(false);
  pendingAddId  = signal<string | null>(null);
  placedOrder   = signal<Order | null>(null);
  stockConflict = signal<StockConflict | null>(null);

  /** CSS variables del tema del negocio (con fallback a KARD). */
  themeVars = computed(() => ({
    '--sf-primary': this.store()?.theme?.primary ?? DEFAULT_PRIMARY,
    '--sf-accent':  this.store()?.theme?.accent  ?? DEFAULT_ACCENT,
  }));

  // ── Carga ─────────────────────────────────────────────
  init(slug: string): void {
    if (this.slug === slug && this.store()) return;   // ya cargada
    this.slug = slug;
    this.loadingStore.set(true);
    this.notFound.set(false);

    this.sf.getStore(slug).subscribe({
      next: (info) => { this.store.set(info); this.loadingStore.set(false); },
      error: () => { this.notFound.set(true); this.loadingStore.set(false); }
    });

    this.loadCart();
  }

  private loadCart(): void {
    this.cartSvc.get(this.slug).subscribe({
      next: (cart) => this.cart.set(cart),
      error: () => this.cart.set(null)   // sin sesión válida o Redis caído
    });
  }

  // ── Carrito ───────────────────────────────────────────
  qtyInCart(productId: string): number {
    return this.cart()?.items.find(i => i.product_id === productId)?.quantity ?? 0;
  }

  addToCart(productId: string): void {
    this.setQuantity(productId, this.qtyInCart(productId) + 1);
  }

  changeQty(productId: string, delta: number): void {
    this.setQuantity(productId, Math.max(0, this.qtyInCart(productId) + delta));
  }

  private setQuantity(productId: string, quantity: number): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.pendingAddId.set(productId);
    this.cartSvc.setItem(this.slug, productId, quantity).subscribe({
      next: (cart) => { this.cart.set(cart); this.cartBusy.set(false); this.pendingAddId.set(null); },
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
      next: () => { this.emptyCartLocally(); this.cartBusy.set(false); },
      error: (err: any) => { this.cartBusy.set(false); this.snack.error(this.cartErrorMessage(err)); }
    });
  }

  openCart(): void  { this.placedOrder.set(null); this.stockConflict.set(null); this.cartOpen.set(true); }
  closeCart(): void { this.cartOpen.set(false); this.placedOrder.set(null); this.stockConflict.set(null); }

  // ── Pedido ────────────────────────────────────────────
  confirmOrder(): void { this.placeOrder('reject'); }
  continueWithoutMissing(): void { this.stockConflict.set(null); this.placeOrder('skip'); }
  dismissConflict(): void { this.stockConflict.set(null); }

  private placeOrder(mode: 'reject' | 'skip'): void {
    if (this.cartBusy()) return;
    this.cartBusy.set(true);
    this.orderSvc.create(this.slug, mode).subscribe({
      next: (order) => {
        this.cartBusy.set(false);
        this.placedOrder.set(order);
        this.emptyCartLocally();   // el backend ya vació el carrito
        this.snack.success('¡Pedido confirmado!');
      },
      error: (err: any) => {
        this.cartBusy.set(false);
        const body = err.error;
        if (err.status === 409 && body?.code === 'INSUFFICIENT_STOCK') {
          this.stockConflict.set(body as StockConflict);
        } else {
          this.snack.error(body?.error ?? 'No se pudo confirmar el pedido.');
        }
        this.loadCart();   // el stock pudo cambiar del lado del server
      }
    });
  }

  private emptyCartLocally(): void {
    this.cart.update(c => c ? { ...c, items: [], total: '0.00', item_count: 0 } : c);
  }

  private cartErrorMessage(err: any): string {
    if (err.status === 401) return 'Tu sesión expiró. Vuelve a iniciar sesión.';
    if (err.status === 503) return 'El carrito no está disponible en este momento.';
    return err.error?.error ?? 'No se pudo actualizar el carrito.';
  }

  /** Motivo legible de por qué un producto no se puede vender. */
  reasonLabel(reason: string): string {
    switch (reason) {
      case 'product_shortage':       return 'Sin stock suficiente';
      case 'ingredient_shortage':    return 'Faltan ingredientes';
      case 'product_and_ingredient': return 'Sin stock y faltan ingredientes';
      case 'unavailable':            return 'Ya no está disponible';
      default:                       return 'No disponible';
    }
  }
}
