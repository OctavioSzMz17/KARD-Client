import { Component, ElementRef, HostListener, OnInit, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { BillingService } from '../../../core/services/billing.service';
import { SnackbarService } from '../../../core/services/snackbar.service';
import { UpgradeService } from '../../../core/services/upgrade.service';
import { PlanStore } from '../../../core/store/plan.store';
import { ChangePlanPreview, Plan, PlanInfo } from '../../../core/models/plan.models';
import { formatDay } from '../../../core/plan-notice.logic';
import { CheckoutDialogComponent } from '../checkout-dialog/checkout-dialog.component';
import { formatMoney, planCard, upgradeGains } from '../subscription-logic';

/**
 * `loading`: pregunta el plan y la vista previa. `checkout`: no tiene
 * suscripción, así que subir es un primer pago (15A). `preview`/`confirming`:
 * lo que gana y lo que paga. `pending`: el banco no cobró la diferencia.
 */
type View = 'loading' | 'checkout' | 'preview' | 'confirming' | 'pending' | 'error';

/**
 * Flujo 15B, subir de plan con la suscripción ya pagada. Al abrir pide la
 * vista previa del prorrateo y confirma con la MISMA `proration_date`, para
 * cobrar exactamente lo que se mostró.
 */
@Component({
  selector: 'app-upgrade-dialog',
  imports: [CheckoutDialogComponent],
  templateUrl: './upgrade-dialog.component.html',
  styleUrl: './upgrade-dialog.component.scss',
})
export class UpgradeDialogComponent implements OnInit {
  private billing = inject(BillingService);
  private plan = inject(PlanStore);
  private snack = inject(SnackbarService);
  private upgrades = inject(UpgradeService);

  readonly target = input.required<Plan>();
  readonly closed = output<void>();

  protected readonly view = signal<View>('loading');
  protected readonly info = signal<PlanInfo | null>(null);
  protected readonly preview = signal<ChangePlanPreview | null>(null);
  protected readonly errorMessage = signal('');
  protected readonly paymentUrl = signal<string | null>(null);

  protected readonly card = computed(() => planCard(this.target()));
  protected readonly gains = computed(() => {
    const info = this.info();
    return info ? upgradeGains(this.target(), info) : [];
  });
  protected readonly amount = computed(() => {
    const p = this.preview();
    return p ? formatMoney(p.amount, p.currency) : '';
  });
  protected readonly renewsOn = computed(() => {
    const end = this.preview()?.current_period_end;
    return end ? formatDay(end) : null;
  });

  private readonly heading = viewChild<ElementRef<HTMLElement>>('heading');

  constructor() {
    // Al cambiar de vista, el foco va al título (teclado y lector de pantalla).
    effect(() => {
      this.view();
      this.heading()?.nativeElement.focus();
    });
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.view.set('loading');
    this.billing.getPlan().subscribe({
      next: info => {
        this.info.set(info);
        // Sin suscripción no hay nada que prorratear: subir es contratar (15A).
        if (!info.has_subscription) return this.view.set('checkout');
        this.billing.previewChange(this.target()).subscribe({
          next: preview => { this.preview.set(preview); this.view.set('preview'); },
          error: err => this.fail(err, 'No pudimos calcular el cambio.'),
        });
      },
      error: err => this.fail(err, 'No pudimos cargar tu suscripción.'),
    });
  }

  confirm(): void {
    const preview = this.preview();
    if (!preview || this.view() !== 'preview') return;
    this.view.set('confirming');
    this.billing.changePlan(this.target(), undefined, preview.proration_date).subscribe({
      next: res => {
        if (res.status === 'payment_pending') {
          // El plan NO cambió: el banco rechazó o pidió verificación.
          this.paymentUrl.set(res.payment_url);
          this.view.set('pending');
          return;
        }
        this.plan.apply(res.access);      // el menú se redibuja ya, sin recargar
        this.upgrades.markApplied();
        this.snack.success(`Ya tienes ${this.card().nombre}`);
        this.closed.emit();
      },
      error: err => this.fail(err, 'No pudimos cambiar tu plan. No se hizo ningún cobro.'),
    });
  }

  /** Abre la factura de Stripe en otra pestaña: al pagarla, el cambio se aplica solo. */
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
    if (this.view() !== 'confirming') this.closed.emit();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    // En la vista de primer pago el modal de 15A maneja su propio Escape.
    if (this.view() !== 'checkout') this.close();
  }

  private fail(err: { error?: { error?: string } } | null, fallback: string): void {
    this.errorMessage.set(err?.error?.error ?? fallback);
    this.view.set('error');
  }
}
