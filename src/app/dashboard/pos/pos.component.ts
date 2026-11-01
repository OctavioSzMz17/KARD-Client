import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CashService, CashSession } from '../../core/services/cash.service';
import { PaymentMethod, PosFulfillment, PosSale, SalesService } from '../../core/services/sales.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { Product, ProductStore } from '../../core/store/product.store';
import { ProductImage } from '../../core/services/image.service';
import {
  DiscountKind,
  centsToApi,
  changeFor,
  computeTotals,
  formatCents,
  formatMoney,
  quickAmounts,
  toCents,
} from './pos-math';
import { printSheet } from './print';
import { ReceiptComponent } from './receipt.component';

interface CartItem {
  product: Product;
  quantity: number;
}

const PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
  { value: 'transfer', label: 'Transferencia' },
];

/**
 * Pantalla de cobro (punto de venta). Es la contraparte de pantalla de
 * `POST /orders/business/sales`: arma el ticket, calcula descuento, propina y
 * cambio con la misma matemática que el servidor (`pos-math.ts`) y, al cobrar,
 * muestra el ticket imprimible.
 */
@Component({
  selector: 'app-pos',
  imports: [RouterLink, ReceiptComponent],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.scss',
})
export class PosComponent implements OnInit {
  private store = inject(ProductStore);
  private cashSvc = inject(CashService);
  private sales = inject(SalesService);
  private snack = inject(SnackbarService);

  readonly paymentOptions = PAYMENT_OPTIONS;
  readonly tipPercents = [10, 15, 20];
  readonly money = formatMoney;
  readonly cents = formatCents;

  // ── Caja ──────────────────────────────────────────────
  /** undefined = cargando, null = cerrada, objeto = turno abierto. */
  readonly session = signal<CashSession | null | undefined>(undefined);
  readonly floatText = signal('');
  readonly opening = signal(false);

  // ── Catálogo ──────────────────────────────────────────
  readonly loading = this.store.loading;
  readonly query = signal('');
  readonly category = signal<string>('');

  private readonly finals = computed(() =>
    this.store.products().filter(p => p.product_type === 'final' && !p.is_deleted),
  );

  /** Categorías presentes en el catálogo (restaurantes); vacío si el negocio no las usa. */
  readonly categories = computed(() => {
    const set = new Set<string>();
    for (const p of this.finals()) {
      const c = p.metadata?.['categoria'];
      if (typeof c === 'string' && c) set.add(c);
    }
    return [...set].sort();
  });

  readonly visible = computed(() => {
    const q = this.query().trim().toLowerCase();
    const cat = this.category();
    return this.finals().filter(p => {
      if (cat && p.metadata?.['categoria'] !== cat) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.barcode ?? '').toLowerCase().includes(q)
      );
    });
  });

  // ── Ticket ────────────────────────────────────────────
  readonly cart = signal<CartItem[]>([]);
  readonly discountKind = signal<DiscountKind>('percent');
  readonly discountText = signal('');
  readonly tipText = signal('');
  readonly payment = signal<PaymentMethod>('cash');
  readonly receivedText = signal('');
  readonly fulfillment = signal<PosFulfillment>('takeaway');
  readonly tableNumber = signal('');
  readonly customerName = signal('');

  readonly charging = signal(false);
  readonly receipt = signal<PosSale | null>(null);

  readonly itemCount = computed(() => this.cart().reduce((n, l) => n + l.quantity, 0));

  readonly totals = computed(() =>
    computeTotals(
      this.cart().map(l => ({ price: l.product.price, quantity: l.quantity })),
      this.discountText().trim() ? { kind: this.discountKind(), value: this.discountText() } : null,
      this.tipText(),
    ),
  );

  readonly change = computed(() => changeFor(this.totals().total, this.receivedText()));
  readonly quick = computed(() => quickAmounts(this.totals().total));

  /** Por qué todavía no se puede cobrar, o null si ya se puede. */
  readonly blocker = computed<string | null>(() => {
    if (!this.session()) return 'Abre la caja para cobrar';
    if (this.cart().length === 0) return 'Agrega productos al ticket';
    const t = this.totals();
    if (t.error) return t.error;
    if (this.fulfillment() === 'dine_in' && !this.tableNumber().trim()) return 'Escribe el número de mesa';
    if (this.payment() === 'cash' && !this.change().enough) {
      return this.receivedText().trim()
        ? `Faltan ${formatCents(this.change().missing)}`
        : 'Escribe cuánto entrega el cliente';
    }
    return null;
  });

  ngOnInit(): void {
    this.store.load();
    this.refreshSession();
  }

  // ── Caja ──────────────────────────────────────────────
  refreshSession(): void {
    this.cashSvc.current().subscribe({
      next: s => this.session.set(s),
      error: () => {
        this.session.set(null);
        this.snack.error('No se pudo consultar la caja.');
      },
    });
  }

  openCash(): void {
    const amount = this.floatText().trim() === '' ? '0' : this.floatText();
    const cents = toCents(amount);
    if (cents === null) {
      this.snack.error('Escribe un fondo inicial válido.');
      return;
    }
    this.opening.set(true);
    this.cashSvc.open(centsToApi(cents)).subscribe({
      next: s => {
        this.session.set(s);
        this.opening.set(false);
        this.floatText.set('');
        this.snack.success('Caja abierta.');
      },
      error: err => {
        this.opening.set(false);
        if (err.error?.code === 'CASH_ALREADY_OPEN') this.refreshSession();
        this.snack.error(err.error?.error ?? 'No se pudo abrir la caja.');
      },
    });
  }

  // ── Catálogo ──────────────────────────────────────────
  primaryImage(images: ProductImage[]): ProductImage | null {
    return images.find(i => i.sort_order === 0) ?? images[0] ?? null;
  }

  onQuery(e: Event): void {
    this.query.set((e.target as HTMLInputElement).value);
  }

  /**
   * Enter en el buscador: lo que dispara una pistola de código de barras.
   * Un SKU o código exacto agrega el producto de inmediato; si no, y solo
   * queda un resultado, se agrega ese.
   */
  onSearchEnter(): void {
    const q = this.query().trim().toLowerCase();
    if (!q) return;
    const exact = this.finals().find(
      p => (p.barcode ?? '').toLowerCase() === q || (p.sku ?? '').toLowerCase() === q,
    );
    const target = exact ?? (this.visible().length === 1 ? this.visible()[0] : null);
    if (target) {
      this.add(target);
      this.query.set('');
    } else {
      this.snack.warning(this.visible().length ? 'Hay varias coincidencias: toca el producto.' : 'No hay productos con ese código.');
    }
  }

  // ── Ticket ────────────────────────────────────────────
  add(product: Product): void {
    this.cart.update(lines => {
      const found = lines.find(l => l.product.product_id === product.product_id);
      return found
        ? lines.map(l => (l === found ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { product, quantity: 1 }];
    });
  }

  step(line: CartItem, delta: number): void {
    const next = line.quantity + delta;
    if (next <= 0) {
      this.remove(line);
      return;
    }
    this.cart.update(lines => lines.map(l => (l === line ? { ...l, quantity: Math.min(next, 999) } : l)));
  }

  remove(line: CartItem): void {
    this.cart.update(lines => lines.filter(l => l !== line));
  }

  lineTotal(line: CartItem): string {
    const cents = (toCents(line.product.price) ?? 0) * line.quantity;
    return formatCents(cents);
  }

  setDiscountKind(kind: DiscountKind): void {
    this.discountKind.set(kind);
  }

  setTipPercent(percent: number): void {
    const base = this.totals().subtotal - this.totals().discount;
    const tip = Math.floor((base * percent + 50) / 100);
    this.tipText.set(tip > 0 ? centsToApi(tip) : '');
  }

  isTipPercent(percent: number): boolean {
    const base = this.totals().subtotal - this.totals().discount;
    const tip = toCents(this.tipText());
    return tip !== null && tip > 0 && tip === Math.floor((base * percent + 50) / 100);
  }

  setReceived(cents: number): void {
    this.receivedText.set(centsToApi(cents));
  }

  isReceived(cents: number): boolean {
    return toCents(this.receivedText()) === cents;
  }

  setPayment(method: PaymentMethod): void {
    this.payment.set(method);
    if (method !== 'cash') this.receivedText.set('');
  }

  clearTicket(): void {
    this.cart.set([]);
    this.discountText.set('');
    this.tipText.set('');
    this.receivedText.set('');
    this.tableNumber.set('');
    this.customerName.set('');
    this.payment.set('cash');
    this.fulfillment.set('takeaway');
  }

  // ── Cobro ─────────────────────────────────────────────
  charge(): void {
    if (this.blocker() || this.charging()) return;

    const t = this.totals();
    const body = {
      items: this.cart().map(l => ({ product_id: l.product.product_id, quantity: l.quantity })),
      payment_method: this.payment(),
      fulfillment_type: this.fulfillment(),
      ...(this.fulfillment() === 'dine_in' ? { table_number: this.tableNumber().trim() } : {}),
      ...(this.customerName().trim() ? { customer_name: this.customerName().trim() } : {}),
      ...(this.discountText().trim()
        ? { discount: { type: this.discountKind(), value: this.discountText().trim() } }
        : {}),
      ...(t.tip > 0 ? { tip: centsToApi(t.tip) } : {}),
      ...(this.payment() === 'cash' ? { amount_received: centsToApi(toCents(this.receivedText()) ?? 0) } : {}),
    };

    this.charging.set(true);
    this.sales.charge(body).subscribe({
      next: sale => {
        this.charging.set(false);
        this.receipt.set(sale);
        this.clearTicket();
        // Una venta mueve inventario e insumos: el cache de productos ya no es vigente.
        this.store.invalidate();
        this.refreshSession();
      },
      error: err => {
        this.charging.set(false);
        this.snack.error(this.explain(err));
        if (err.error?.code === 'CASH_CLOSED') this.session.set(null);
      },
    });
  }

  private explain(err: any): string {
    const body = err?.error;
    if (body?.code === 'INSUFFICIENT_STOCK') {
      const names: string[] = (body.details?.unavailable ?? []).map((u: any) => u.product_name);
      return names.length ? `No hay existencias de: ${names.join(', ')}.` : body.error;
    }
    return body?.error ?? 'No se pudo registrar la venta.';
  }

  // ── Ticket impreso ────────────────────────────────────
  print(): void {
    printSheet();
  }

  closeReceipt(): void {
    this.receipt.set(null);
  }
}
