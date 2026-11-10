import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable, tap } from 'rxjs';
import { AuthService } from './auth.service';
import { SnackbarService } from './snackbar.service';
import { environment } from '../../../environments/environment';
import { BoardSale, OrderPatch, OrdersQueue, newOrders } from '../orders-board-logic';

const API = environment.apiUrl;

/** Cada cuánto se pregunta por pedidos nuevos mientras la pestaña está a la vista. */
export const POLL_MS = 15_000;

/**
 * Los pedidos que hacen los clientes desde la tienda — endpoint B2B, requiere JWT de negocio.
 *
 * Es un servicio de toda la sesión del panel (no de una pantalla) para que el aviso de pedidos
 * nuevos y el contador del menú sigan vivos aunque el negocio esté en otra sección. El panel lo
 * arranca al entrar (`start`) y lo detiene al salir (`stop`).
 */
@Injectable({ providedIn: 'root' })
export class OrdersBoardService {
  private http  = inject(HttpClient);
  private auth  = inject(AuthService);
  private snack = inject(SnackbarService);

  readonly queue   = signal<OrdersQueue | null>(null);
  readonly loading = signal(false);
  /** La última consulta falló. Se conserva lo que ya se veía: es mejor que una pantalla vacía. */
  readonly failed  = signal(false);

  /** Pedidos nuevos sin atender: el número que va junto a "Órdenes" en el menú. */
  readonly pending = computed(() => this.queue()?.counts.preparing ?? 0);

  /** Los pedidos que ya se vieron, para avisar solo de los que lleguen después. `null` antes de la primera carga. */
  private seen: Set<string> | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private audio: AudioContext | null = null;

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  /** Ya está consultando. */
  get running(): boolean { return this.timer !== null; }

  /** Empieza a consultar. Llamarlo dos veces no duplica la consulta. */
  start(): void {
    if (this.timer) return;
    this.refresh();
    this.timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') this.refresh();
    }, POLL_MS);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', this.onVisible);
  }

  /** Deja de consultar y olvida lo visto (al cerrar sesión no debe quedar nada del negocio anterior). */
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisible);
    this.queue.set(null);
    this.seen = null;
    this.failed.set(false);
  }

  private onVisible = (): void => {
    if (document.visibilityState === 'visible') this.refresh();
  };

  refresh(): void {
    this.loading.set(true);
    this.http.get<OrdersQueue>(`${API}/orders/business/queue`, { headers: this.headers }).subscribe({
      next: queue => {
        this.announce(newOrders(this.seen, queue.items));
        this.seen = new Set(queue.items.map(s => s.order_id));
        this.queue.set(queue);
        this.failed.set(false);
        this.loading.set(false);
      },
      error: () => { this.failed.set(true); this.loading.set(false); },
    });
  }

  /** Mueve un pedido (su entrega, su pago, o ambos) y vuelve a pedir el tablero. */
  move(orderId: string, patch: OrderPatch): Observable<BoardSale> {
    return this.http
      .patch<BoardSale>(`${API}/orders/business/sales/${orderId}/status`, patch, { headers: this.headers })
      .pipe(tap(() => this.refresh()));
  }

  /** Avisa con un mensaje y un tono corto de que llegaron pedidos. */
  private announce(fresh: BoardSale[]): void {
    if (fresh.length === 0) return;
    const text = fresh.length === 1
      ? `Nueva orden de ${fresh[0].customer_name} · $${Number(fresh[0].total).toFixed(2)}`
      : `${fresh.length} órdenes nuevas`;
    this.snack.info(text);
    this.beep();
  }

  /** Dos tonos cortos. Si el navegador no deja sonar (nadie ha tocado la página todavía), no pasa nada. */
  private beep(): void {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.audio ??= new Ctx();
      const ctx = this.audio;
      const now = ctx.currentTime;
      [880, 1175].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, now + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.18 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.16);
        osc.connect(gain).connect(ctx.destination);
        osc.start(now + i * 0.18);
        osc.stop(now + i * 0.18 + 0.17);
      });
    } catch { /* un aviso sonoro es una comodidad, no una función */ }
  }
}
