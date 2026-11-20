import { Component, ElementRef, HostListener, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { BillingService } from '../../../core/services/billing.service';
import { Channel, PlanInfo } from '../../../core/models/plan.models';
import { channelSwitchCopy } from '../subscription-logic';

/**
 * Flujo 15D, cambiar la mitad de Starter. Confirma antes, porque solo se puede
 * una vez cada 30 días y la otra mitad deja de estar disponible (nada se borra).
 *
 * Si el servidor responde `409 channel_cooldown`, el interceptor ya muestra
 * "Podrás cambiar el {fecha}": este modal se cierra y pide recargar.
 */
@Component({
  selector: 'app-channel-dialog',
  templateUrl: './channel-dialog.component.html',
  styleUrl: './channel-dialog.component.scss',
})
export class ChannelDialogComponent {
  private billing = inject(BillingService);

  /** La mitad a la que quiere cambiar. */
  readonly target = input.required<Channel>();
  readonly closed = output<void>();
  /** El cambio se aplicó: el `PlanInfo` ya actualizado. */
  readonly changed = output<PlanInfo>();
  /** Hay que volver a pedir el estado (p. ej. tras el aviso de que aún no puede cambiar). */
  readonly reload = output<void>();

  protected readonly copy = computed(() => channelSwitchCopy(this.target()));
  protected readonly sending = signal(false);
  protected readonly error = signal('');

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    effect(() => this.heading()?.nativeElement.focus());
  }

  confirm(): void {
    if (this.sending()) return;
    this.sending.set(true);
    this.error.set('');
    this.billing.changeChannel(this.target()).subscribe({
      next: info => {
        this.sending.set(false);
        this.changed.emit(info);
        this.closed.emit();
      },
      error: err => {
        this.sending.set(false);
        if (err?.error?.code === 'channel_cooldown') {
          // El aviso con la fecha ya está en pantalla (interceptor).
          this.reload.emit();
          this.closed.emit();
          return;
        }
        this.error.set(err?.error?.error ?? 'No pudimos cambiar tu mitad. Sigue igual.');
      },
    });
  }

  close(): void {
    if (!this.sending()) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
