import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { AuthService } from '../../core/services/auth.service';
import { OrdersBoardService } from '../../core/services/orders-board.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { PERM } from '../../core/permissions';
import {
  BOARD_STATES, BoardSale, BoardState, OrderPatch, PAYMENT_LABELS, STATE_LABELS,
  addressLines, groupByState, isLate, modeLabel, needsPayment, nextStep, shortFolio, waitLabel,
} from '../../core/orders-board-logic';

/**
 * El tablero de órdenes: los pedidos que hacen los clientes desde la tienda, en columnas según
 * dónde van (nuevos, listos, en camino) y con lo ya cerrado aparte.
 *
 * La consulta periódica y el aviso de pedidos nuevos viven en `OrdersBoardService` (los usa
 * también el contador del menú); aquí solo se muestra y se mueve cada pedido.
 */
@Component({
  selector: 'app-orders',
  templateUrl: './orders.component.html',
  styleUrl: './orders.component.scss',
})
export class OrdersComponent implements OnInit, OnDestroy {
  private board = inject(OrdersBoardService);
  private auth  = inject(AuthService);
  private snack = inject(SnackbarService);

  readonly queue  = this.board.queue;
  readonly failed = this.board.failed;
  /** Todavía no llega la primera respuesta. */
  readonly firstLoad = computed(() => this.queue() === null && !this.failed());

  readonly columns = computed(() => groupByState(this.queue()?.items ?? []));

  /** Las columnas de lo que sigue en marcha; "En camino" solo aparece si hay algo ahí. */
  readonly activeColumns = computed<BoardState[]>(() => {
    const cols = this.columns();
    return (['preparing', 'ready', 'in_transit'] as const).filter(s => s !== 'in_transit' || cols.in_transit.length > 0);
  });

  readonly closedCount = computed(() => this.columns().completed.length + this.columns().canceled.length);
  readonly activeCount = computed(() => BOARD_STATES.slice(0, 3).reduce((n, s) => n + this.columns()[s].length, 0));
  readonly awaitingPayment = computed(() => this.queue()?.awaiting_payment ?? 0);

  /** Quien solo puede ver las ventas no mueve pedidos. */
  readonly canManage = computed(() => this.auth.can(PERM.salesManage));

  /** Los pedidos cerrados (entregados y cancelados) se muestran desplegados a pedido. */
  readonly showClosed = signal(false);
  /** El pedido que se está moviendo ahora, para no dejar pulsar dos veces. */
  readonly busy = signal<string | null>(null);
  /** El pedido que espera confirmación de cancelación. */
  readonly confirming = signal<string | null>(null);

  /** La hora de la pantalla, que avanza sola para que "hace 5 min" no se quede viejo. */
  readonly now = signal(Date.now());
  private clock: ReturnType<typeof setInterval> | null = null;

  readonly labels = STATE_LABELS;
  readonly money = (v: string | number) => `$${Number(v).toFixed(2)}`;
  readonly mode = modeLabel;
  readonly wait = (s: BoardSale) => waitLabel(s.created_at, this.now());
  readonly late = (s: BoardSale) => isLate(s, this.now());
  readonly folio = (s: BoardSale) => shortFolio(s.order_id);
  readonly address = (s: BoardSale) => addressLines(s.shipping_address);
  readonly step = nextStep;
  readonly needsPayment = needsPayment;
  readonly paymentLabel = (m?: string | null) => (m ? PAYMENT_LABELS[m] ?? m : null);

  ngOnInit(): void {
    // El panel ya lo arranca al entrar; aquí solo se pide un dato fresco al abrir la pantalla.
    if (this.board.running) this.board.refresh();
    else this.board.start();
    this.clock = setInterval(() => this.now.set(Date.now()), 30_000);
  }

  ngOnDestroy(): void {
    if (this.clock) clearInterval(this.clock);
  }

  reload(): void { this.board.refresh(); }

  toggleClosed(): void { this.showClosed.update(v => !v); }

  advance(sale: BoardSale): void {
    const paso = nextStep(sale);
    if (paso) this.send(sale, paso.patch, 'No se pudo mover el pedido.');
  }

  markPaid(sale: BoardSale): void {
    this.send(sale, { status: 'paid' }, 'No se pudo marcar el pago.');
  }

  askCancel(sale: BoardSale): void { this.confirming.set(sale.order_id); }
  keep(): void { this.confirming.set(null); }

  cancel(sale: BoardSale): void {
    this.confirming.set(null);
    this.send(sale, { status: 'canceled', fulfillment_status: 'canceled' }, 'No se pudo cancelar el pedido.');
  }

  /**
   * Deshace una entrega marcada por error: el pedido vuelve a "Nuevas". Solo para los entregados:
   * un pedido cancelado ya devolvió su inventario y no se reabre (el servidor lo rechaza).
   */
  reopen(sale: BoardSale): void {
    this.send(sale, { fulfillment_status: 'preparing' }, 'No se pudo reabrir el pedido.');
  }

  private send(sale: BoardSale, patch: OrderPatch, failure: string): void {
    if (this.busy()) return;
    this.busy.set(sale.order_id);
    this.board.move(sale.order_id, patch).subscribe({
      next: () => this.busy.set(null),
      error: err => {
        this.busy.set(null);
        this.snack.error(
          err?.status === 403 ? 'Tu puesto no puede mover pedidos.' : (err?.error?.error ?? failure),
        );
      },
    });
  }

  trackSale = (_: number, s: BoardSale) => s.order_id;
}
