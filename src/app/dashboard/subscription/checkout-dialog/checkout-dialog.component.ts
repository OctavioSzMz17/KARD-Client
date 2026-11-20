import { Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { BillingService } from '../../../core/services/billing.service';
import { SnackbarService } from '../../../core/services/snackbar.service';
import { Channel } from '../../../core/models/plan.models';
import { CHANNEL_OPTIONS, PlanCard, channelName } from '../subscription-logic';

type Step = 'channel' | 'summary';

/**
 * Flujo 15A, primer pago: Starter pide elegir la mitad; Pro y Enterprise van
 * directo al resumen. "Ir a pagar" abre Stripe, y al volver la pantalla de
 * Suscripción espera a que el plan se active.
 */
@Component({
  selector: 'app-checkout-dialog',
  templateUrl: './checkout-dialog.component.html',
  styleUrl: './checkout-dialog.component.scss',
})
export class CheckoutDialogComponent {
  private billing = inject(BillingService);
  private snack = inject(SnackbarService);

  /** El plan que eligió. */
  readonly card = input.required<PlanCard>();
  /** La mitad que ya tenía (al volver tras cancelar), marcada de entrada. */
  readonly initialChannel = input<Channel | null>(null);
  readonly closed = output<void>();

  protected readonly channels = CHANNEL_OPTIONS;
  protected readonly needsChannel = computed(() => this.card().key === 'starter');

  protected readonly step = signal<Step>('summary');
  protected readonly channel = signal<Channel | null>(null);
  protected readonly sending = signal(false);

  /** "Starter con Punto de venta" o "Pro". */
  protected readonly summaryName = computed(() => {
    const c = this.channel();
    return this.needsChannel() && c ? `${this.card().nombre} con ${channelName(c)}` : this.card().nombre;
  });

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    // Se fija una sola vez al abrir: después manda lo que la persona elija.
    effect(() => {
      this.step.set(this.needsChannel() ? 'channel' : 'summary');
      this.channel.set(this.initialChannel());
    });
    // Al cambiar de paso, el foco va al título (teclado y lector de pantalla).
    effect(() => {
      this.step();
      this.heading()?.nativeElement.focus();
    });
  }

  pick(channel: Channel): void {
    this.channel.set(channel);
  }

  next(): void {
    if (this.channel()) this.step.set('summary');
  }

  back(): void {
    if (this.needsChannel()) this.step.set('channel');
    else this.close();
  }

  close(): void {
    if (!this.sending()) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }

  pay(): void {
    if (this.sending()) return;
    const plan = this.card().key;
    const channel = this.needsChannel() ? this.channel() ?? undefined : undefined;
    if (this.needsChannel() && !channel) return;

    this.sending.set(true);
    this.billing.checkout(plan, channel).subscribe({
      next: res => this.goTo(res.checkout_url),
      error: err => {
        this.sending.set(false);
        // 503 = el cobro no está configurado en este entorno.
        this.snack.error(err?.error?.error ?? (err?.status === 503 ? 'El cobro no está disponible todavía' : 'No se pudo iniciar el pago'));
      },
    });
  }

  /** Se va a Stripe. Aparte para poder probar el flujo sin salir de la página. */
  goTo(url: string): void {
    window.location.href = url;
  }
}
