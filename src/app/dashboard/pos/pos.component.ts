import { Component, ElementRef, OnInit, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';
import { PERM } from '../../core/permissions';
import { CashService, CashSession } from '../../core/services/cash.service';
import { PaymentMethod, PosFulfillment, PosSale, SalesService } from '../../core/services/sales.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { TicketSyncService } from '../../core/services/ticket-sync.service';
import { linesToCart, localTicketUid, ops } from '../../core/ticket-sync-logic';
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
import { ScanStatus } from './scan-logic';
import { ScannerComponent } from './scanner.component';

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
  imports: [RouterLink, ReceiptComponent, ScannerComponent],
  templateUrl: './pos.component.html',
  styleUrl: './pos.component.scss',
  // Una por pantalla de cobro: se detiene sola al salir.
  providers: [TicketSyncService],
})
export class PosComponent implements OnInit {
  private store = inject(ProductStore);
  private cashSvc = inject(CashService);
  private sales = inject(SalesService);
  private snack = inject(SnackbarService);
  private auth = inject(AuthService);

  /**
   * Ticket compartido: si esta sesión opera una caja, su ticket es el MISMO que ve la computadora
   * de esa caja (y el celular de quien la opera). Si no opera ninguna, el ticket es solo de esta pantalla.
   */
  readonly sync = inject(TicketSyncService);

  /** Identificador de un ticket que no está compartido; sirve de llave de idempotencia del cobro. */
  private readonly localUid = signal(localTicketUid());

  /** La llave de idempotencia de ESTE ticket: la misma para quien lo cobre, desde donde lo cobre. */
  readonly ticketUid = computed(() => {
    const shared = this.sync.ticket();
    return this.sync.enabled() && shared ? shared.uid : this.localUid();
  });

  constructor() {
    // Lo que dice el servidor (lo que escaneó el celular, lo que borró la laptop) se refleja en pantalla.
    effect(() => {
      const shared = this.sync.ticket();
      const products = this.finals();
      if (!this.sync.enabled() || !shared) return;
      const next = linesToCart(shared.lines, products);
      untracked(() => {
        // Se vació desde otra pantalla (la cobraron o la vaciaron allá): se avisa, no desaparece sin más.
        if (next.length === 0 && this.cart().length > 0 && !this.charging() && !this.receipt()) {
          this.snack.info('El ticket se vació o se cobró desde otro dispositivo.');
        }
        this.cart.set(next);
      });
    });

    effect(() => {
      const aviso = this.sync.notice();
      if (aviso) untracked(() => this.snack.warning(aviso.text));
    });
  }

  /** Panel del ticket: en celular queda debajo del catálogo y la barra flotante lleva a él. */
  private ticketPanel = viewChild<ElementRef<HTMLElement>>('ticketPanel');

  readonly paymentOptions = PAYMENT_OPTIONS;
  readonly tipPercents = [10, 15, 20];
  readonly money = formatMoney;
  readonly cents = formatCents;

  // ── Caja ──────────────────────────────────────────────
  /** undefined = cargando, null = cerrada, objeto = turno abierto. */
  readonly session = signal<CashSession | null | undefined>(undefined);
  /** Abrir la caja es de quien está a cargo; el resto espera a que la abran. */
  readonly canOpenCash = computed(() => this.auth.can(PERM.cashManage));
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

  // ── Escáner de cámara ─────────────────────────────────
  /** El navegador puede abrir una cámara (hace falta https o localhost). */
  readonly canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;
  readonly scannerOpen = signal(false);
  readonly scanStatus = signal<ScanStatus | null>(null);
  private scanCounter = 0;

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
    this.sync.start();
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

  // ── Escáner de cámara ─────────────────────────────────
  openScanner(): void {
    if (!this.session()) {
      this.snack.warning('Abre la caja para poder cobrar.');
      return;
    }
    this.scanStatus.set(null);
    this.scannerOpen.set(true);
  }

  closeScanner(): void {
    this.scannerOpen.set(false);
  }

  /** Resumen sobre el botón "Listo" del escáner. */
  readonly scanSummary = computed(() =>
    this.itemCount() === 0
      ? 'Todavía no hay productos'
      : `${this.itemCount()} en el ticket · ${formatCents(this.totals().total)}`,
  );

  private report(ok: boolean, text: string): void {
    this.scanStatus.set({ n: ++this.scanCounter, ok, text });
  }

  /**
   * Una lectura de la cámara: se busca el producto y, si es vendible, entra al ticket.
   * Primero en el catálogo ya cargado (instantáneo) y, si no está, en el servidor.
   */
  onScanned(code: string): void {
    const q = code.toLowerCase();
    const local = this.finals().find(
      p => p.barcode === code || (p.sku ?? '').toLowerCase() === q || p.product_id === code,
    );
    if (local) {
      this.addScanned(local);
      return;
    }

    this.store.lookup(code).subscribe({
      next: product => this.addScanned(product),
      error: err => {
        this.report(false, err?.status === 404 ? `Código no registrado: ${code}` : 'No se pudo buscar el producto.');
      },
    });
  }

  private addScanned(product: Product): void {
    if (product.product_type !== 'final') {
      this.report(false, `${product.name} es un insumo, no se vende.`);
      return;
    }
    this.add(product);
    const qty = this.cart().find(l => l.product.product_id === product.product_id)?.quantity ?? 1;
    this.report(true, `${product.name} · ${qty} en el ticket`);
  }

  // ── Ticket ────────────────────────────────────────────
  // Cada cambio se ve al instante en esta pantalla y, si la caja es compartida, se manda al servidor
  // para que la otra pantalla lo vea. El servidor tiene la última palabra.
  add(product: Product): void {
    this.cart.update(lines => {
      const found = lines.find(l => l.product.product_id === product.product_id);
      return found
        ? lines.map(l => (l === found ? { ...l, quantity: l.quantity + 1 } : l))
        : [...lines, { product, quantity: 1 }];
    });
    this.sync.send(ops.add(product.product_id));
  }

  step(line: CartItem, delta: number): void {
    const next = line.quantity + delta;
    if (next <= 0) {
      this.remove(line);
      return;
    }
    const quantity = Math.min(next, 999);
    this.cart.update(lines => lines.map(l => (l === line ? { ...l, quantity } : l)));
    this.sync.send(ops.setQuantity(line.product.product_id, quantity));
  }

  remove(line: CartItem): void {
    this.cart.update(lines => lines.filter(l => l !== line));
    this.sync.send(ops.remove(line.product.product_id));
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
    // Compartido: el servidor lo vacía y le estrena otro identificador. Solo si sigue siendo ESTE
    // ticket, así un "vaciar" tardío no borra el siguiente. Local: se estrena otra llave de cobro.
    if (this.sync.enabled()) this.sync.send(ops.clear(this.sync.ticket()?.uid));
    else this.localUid.set(localTicketUid());
    this.cart.set([]);
    this.discountText.set('');
    this.tipText.set('');
    this.receivedText.set('');
    this.tableNumber.set('');
    this.customerName.set('');
    this.payment.set('cash');
    this.fulfillment.set('takeaway');
  }

  goToTicket(): void {
    this.ticketPanel()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    this.sales.charge(body, this.ticketUid()).subscribe({
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
