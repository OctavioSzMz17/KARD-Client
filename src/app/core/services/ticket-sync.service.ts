import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { AuthService } from './auth.service';
import { environment } from '../../../environments/environment';
import {
  POLL_MS,
  RegisterInfo,
  ResponseOrder,
  TicketOp,
  TicketResponse,
  TicketState,
  pollParams,
} from '../ticket-sync-logic';

const API = environment.apiUrl;

/** Un fallo de red o del servidor: la operación se conserva y se reintenta con la MISMA llave. */
function isTransient(err: HttpErrorResponse): boolean {
  return err.status === 0 || err.status >= 500;
}

/**
 * Ticket compartido de la caja: mantiene al día el ticket entre la computadora y el celular de
 * quien la opera.
 *
 *  · Lee el ticket cada segundo y poco (el servidor contesta 204, sin cuerpo, si no hay nada nuevo).
 *  · Manda cada cambio en orden, uno a la vez. Si se va el internet, los cambios esperan y se
 *    reenvían con la misma llave en cuanto vuelve: el servidor no los aplica dos veces.
 *  · Mientras haya cambios sin confirmar NO se pisa lo que se ve con lo que dice el servidor.
 *
 * Una sesión que no opera ninguna caja no usa nada de esto (`enabled()` es falso): su ticket se
 * queda en su pantalla. Se provee en cada pantalla de cobro, no en la raíz.
 */
@Injectable()
export class TicketSyncService implements OnDestroy {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  /** La caja que opera esta sesión, o null si ninguna. */
  readonly register = signal<RegisterInfo | null>(null);
  /** Último ticket confirmado por el servidor. */
  readonly ticket = signal<TicketState | null>(null);
  /** ¿Se está hablando bien con el servidor? Es la lámpara de "sincronizada". */
  readonly connected = signal(true);
  /** Ya se le preguntó al servidor al menos una vez. */
  readonly ready = signal(false);
  /** Aviso para el usuario (el contador permite repetir el mismo texto). */
  readonly notice = signal<{ n: number; text: string } | null>(null);
  /** Hay cambios que todavía no llegan al servidor. */
  readonly pendingCount = signal(0);

  readonly enabled = computed(() => this.register() !== null);

  private order = new ResponseOrder();
  private pending: TicketOp[] = [];
  private draining = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private noticeCounter = 0;

  private get headers(): HttpHeaders {
    const token = this.auth.getToken();
    return new HttpHeaders(token ? { Authorization: `Bearer ${token}` } : {});
  }

  // ── Ciclo de vida ─────────────────────────────────────
  start(): void {
    if (this.running) return;
    this.running = true;
    this.poll(true);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.tick(), POLL_MS);
  }

  private tick(): void {
    if (!this.running) return;
    if (this.pending.length > 0) {
      this.drain();                   // reintenta lo que no llegó; si llega, la conexión volvió
      this.schedule();
    } else {
      this.poll(false);
    }
  }

  // ── Leer ──────────────────────────────────────────────
  /** Pregunta por el ticket. La primera vez trae todo; después, con 204 si no hay nada nuevo. */
  private poll(full: boolean): void {
    if (!this.running) return;
    const n = this.order.next();
    const known = full ? null : pollParams(this.ticket());
    let params = new HttpParams();
    if (known) params = params.set('since', known.since).set('uid', known.uid);

    this.http.get<TicketResponse>(`${API}/tickets/current`, { headers: this.headers, params, observe: 'response' }).subscribe({
      next: res => {
        this.connected.set(true);
        this.ready.set(true);
        const body = res.body;
        if (res.status === 200 && body) {
          if (body.register === null) {
            this.dropRegister(this.enabled());
            return;
          }
          this.register.set(body.register);
          // El ticket solo vale si salió después de lo último que se aplicó y no hay cambios propios en camino.
          if (this.order.accepts(n) && this.pending.length === 0) {
            this.order.markApplied(n);
            this.ticket.set(body.ticket);
          }
          this.drain();               // lo que esperaba a saber si esta sesión opera una caja
        }
        this.schedule();
      },
      error: () => {
        this.connected.set(false);
        this.ready.set(true);
        this.schedule();
      },
    });
  }

  private apply(res: TicketResponse): void {
    this.register.set(res.register);
    this.ticket.set(res.ticket);
  }

  /** Esta sesión ya no opera ninguna caja: el ticket vuelve a ser de esta pantalla. */
  private dropRegister(hadOne: boolean): void {
    this.register.set(null);
    this.ticket.set(null);
    this.pending = [];
    this.pendingCount.set(0);
    this.stop();
    if (hadOne) this.say('Esta sesión ya no está operando la caja: el ticket se queda solo en esta pantalla.');
  }

  // ── Cambiar ───────────────────────────────────────────
  /** Manda un cambio. Los cambios salen en orden y esperan si no hay conexión. */
  send(op: TicketOp): void {
    // Sin caja, el ticket es de esta pantalla. Antes de saberlo, el cambio espera en la fila.
    if (this.ready() && !this.enabled()) return;
    this.pending.push(op);
    this.pendingCount.set(this.pending.length);
    if (this.enabled()) this.drain();
  }

  private drain(): void {
    if (this.draining || this.pending.length === 0) return;
    const op = this.pending[0];
    const n = this.order.next();
    this.draining = true;

    this.http.post<TicketResponse>(`${API}/tickets/ops`, op, { headers: this.headers }).subscribe({
      next: res => {
        this.draining = false;
        this.pending.shift();
        this.pendingCount.set(this.pending.length);
        this.connected.set(true);
        if (this.pending.length > 0) {
          this.drain();
        } else if (this.order.accepts(n)) {
          this.order.markApplied(n);
          this.apply(res);
        }
      },
      error: (err: HttpErrorResponse) => {
        this.draining = false;
        if (isTransient(err)) {
          // Se queda al frente de la fila; el próximo intento usa la misma llave.
          this.connected.set(false);
          this.schedule();
          return;
        }
        this.pending.shift();
        this.pendingCount.set(this.pending.length);
        this.onRejected(err);
        if (this.pending.length > 0) this.drain();
        else this.refresh();
      },
    });
  }

  private onRejected(err: HttpErrorResponse): void {
    const code = err.error?.code;
    if (code === 'NO_REGISTER') {
      this.dropRegister(true);
    } else if (code === 'TICKET_FULL') {
      this.say('El ticket ya tiene el máximo de productos distintos.');
    } else if (err.status === 404) {
      this.say('Ese producto no se puede agregar al ticket.');
    } else {
      this.say('No se pudo sincronizar el ticket.');
    }
  }

  /** Vuelve a pedir el ticket completo (después de un rechazo, para quedar como el servidor). */
  private refresh(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.poll(true);
  }

  private say(text: string): void {
    this.notice.set({ n: ++this.noticeCounter, text });
  }
}
