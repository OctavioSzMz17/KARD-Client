import {
  Component, ElementRef, HostListener, OnInit, computed, effect, inject, input, output, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, catchError, switchMap, tap } from 'rxjs';
import { BillingService } from '../../../core/services/billing.service';
import { SnackbarService } from '../../../core/services/snackbar.service';
import { UpgradeService } from '../../../core/services/upgrade.service';
import { PlanStore } from '../../../core/store/plan.store';
import { ChangePlanPreview, Channel, PlanInfo } from '../../../core/models/plan.models';
import { CHANNEL_OPTIONS, PlanCard, downgradeLosses, formatMoney, planCard } from '../subscription-logic';

/**
 * Flujo 15C, bajar de plan con la suscripción ya pagada. A Starter hay que
 * elegir qué mitad conserva (la de antes ya marcada); la vista previa se pide
 * con esa mitad y se confirma con la MISMA `proration_date`. No se cobra nada
 * hoy: lo no usado se abona en la siguiente factura.
 *
 * El botón de confirmar va en color neutro, para no empujar la decisión.
 */
@Component({
  selector: 'app-downgrade-dialog',
  templateUrl: './downgrade-dialog.component.html',
  styleUrl: './downgrade-dialog.component.scss',
})
export class DowngradeDialogComponent implements OnInit {
  private billing = inject(BillingService);
  private plan = inject(PlanStore);
  private snack = inject(SnackbarService);
  private upgrades = inject(UpgradeService);

  /** El plan al que baja. */
  readonly card = input.required<PlanCard>();
  /** El estado actual (de `/billing/plan`): uso, mitad y plan vigente. */
  readonly info = input.required<PlanInfo>();
  readonly closed = output<void>();

  protected readonly channels = CHANNEL_OPTIONS;
  protected readonly needsChannel = computed(() => this.card().key === 'starter');
  protected readonly currentName = computed(() => {
    const p = this.info().plan;
    return p ? planCard(p).nombre : 'tu plan';
  });

  protected readonly channel = signal<Channel | null>(null);
  protected readonly preview = signal<ChangePlanPreview | null>(null);
  protected readonly loadingPreview = signal(false);
  protected readonly previewError = signal('');
  protected readonly confirming = signal(false);
  protected readonly confirmError = signal('');
  protected readonly paymentUrl = signal<string | null>(null);

  protected readonly losses = computed(() => downgradeLosses(this.card().key, this.channel(), this.info()));
  protected readonly amount = computed(() => {
    const p = this.preview();
    return p ? formatMoney(p.amount, p.currency) : '';
  });
  protected readonly canConfirm = computed(() =>
    !!this.preview() && !this.loadingPreview() && !this.confirming() && (!this.needsChannel() || !!this.channel()));

  /** Cada mitad elegida pide su vista previa; la anterior se descarta si aún no llegaba. */
  private readonly previews = new Subject<Channel | undefined>();
  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    this.previews.pipe(
      tap(() => { this.loadingPreview.set(true); this.preview.set(null); this.previewError.set(''); }),
      switchMap(channel => this.billing.previewChange(this.card().key, channel).pipe(
        catchError(err => {
          this.loadingPreview.set(false);
          this.previewError.set(err?.error?.error ?? 'No pudimos calcular el cambio.');
          return EMPTY;
        }),
      )),
      takeUntilDestroyed(),
    ).subscribe(preview => { this.preview.set(preview); this.loadingPreview.set(false); });

    // Al abrir (y al pasar a "pago pendiente"), el foco va al título.
    effect(() => this.heading()?.nativeElement.focus());
  }

  ngOnInit(): void {
    // La mitad que tenía antes de subir se conserva en el plan: es la que se marca de entrada.
    const previous = this.needsChannel() ? this.info().access?.channel ?? null : null;
    this.channel.set(previous);
    if (!this.needsChannel() || previous) this.previews.next(previous ?? undefined);
  }

  pick(channel: Channel): void {
    if (channel === this.channel() || this.confirming()) return;
    this.channel.set(channel);
    this.previews.next(channel);
  }

  retryPreview(): void {
    this.previews.next(this.channel() ?? undefined);
  }

  confirm(): void {
    const preview = this.preview();
    if (!preview || !this.canConfirm()) return;
    this.confirming.set(true);
    this.confirmError.set('');
    const channel = this.needsChannel() ? this.channel() ?? undefined : undefined;

    this.billing.changePlan(this.card().key, channel, preview.proration_date).subscribe({
      next: res => {
        this.confirming.set(false);
        if (res.status === 'payment_pending') {
          this.paymentUrl.set(res.payment_url);
          return;
        }
        this.plan.apply(res.access);      // el menú se redibuja ya, sin recargar
        this.upgrades.markApplied();
        this.snack.success(`Tu plan ahora es ${this.card().nombre}`);
        this.closed.emit();
      },
      error: err => {
        this.confirming.set(false);
        this.confirmError.set(err?.error?.error ?? 'No pudimos cambiar tu plan. Tu plan sigue igual.');
      },
    });
  }

  payNow(): void {
    const url = this.paymentUrl();
    if (url) this.openTab(url);
    this.closed.emit();
  }

  /** Aparte para poder probarlo sin abrir pestañas. */
  openTab(url: string): void {
    window.open(url, '_blank', 'noopener');
  }

  close(): void {
    if (!this.confirming()) this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close();
  }
}
