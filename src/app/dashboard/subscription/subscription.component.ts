import { Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { EMPTY, Subscription, catchError, skip, switchMap, take, takeWhile, timer } from 'rxjs';
import { BillingService, PlanInfo } from '../../core/services/billing.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { PlanStore } from '../../core/store/plan.store';
import { UpgradeService } from '../../core/services/upgrade.service';
import { BRAND_NAME } from '../../shared/brand';
import { CheckoutDialogComponent } from './checkout-dialog/checkout-dialog.component';
import { DowngradeDialogComponent } from './downgrade-dialog/downgrade-dialog.component';
import { ChannelDialogComponent } from './channel-dialog/channel-dialog.component';
import { formatDay } from '../../core/plan-notice.logic';
import { Channel } from '../../core/models/plan.models';
import {
  ACTIVATION_POLL_MS, ACTIVATION_POLL_TRIES, CHANNEL_OPTIONS, PLAN_CARDS, PlanButton, PlanCard,
  channelName, channelSwitchCopy, isCurrentPlan, otherChannel, planButton, statusCard, usageBars,
} from './subscription-logic';

/**
 * Al volver de Stripe: `waiting` mientras se pregunta si ya llegó el pago,
 * `slow` si el aviso de Stripe aún no llega tras varios intentos.
 */
type Activation = 'waiting' | 'slow' | null;

@Component({
  selector: 'app-subscription',
  imports: [CheckoutDialogComponent, DowngradeDialogComponent, ChannelDialogComponent],
  templateUrl: './subscription.component.html',
  styleUrl: './subscription.component.scss',
})
export class SubscriptionComponent implements OnInit {
  /** Nombre del producto en pantalla (ver shared/brand.ts). */
  readonly brand = BRAND_NAME;
  private billing = inject(BillingService);
  private plan    = inject(PlanStore);
  private snack   = inject(SnackbarService);
  private route   = inject(ActivatedRoute);
  private router  = inject(Router);
  private destroyRef = inject(DestroyRef);
  private upgrades = inject(UpgradeService);

  info       = signal<PlanInfo | null>(null);
  loading    = signal(true);
  activation = signal<Activation>(null);

  /** El plan cuyo flujo de primer pago (15A) está abierto. */
  checkoutCard = signal<PlanCard | null>(null);

  /** El plan al que quiere bajar (15C), con su modal abierto. */
  downgradeCard = signal<PlanCard | null>(null);

  /** La mitad a la que quiere cambiar (15D), con su modal abierto. */
  channelTarget = signal<Channel | null>(null);

  readonly channelOptions = CHANNEL_OPTIONS;

  /** "Tu mitad" solo existe en un Starter con suscripción (§14 D). */
  readonly currentChannel = computed(() => {
    const i = this.info();
    return i?.has_subscription && i.plan === 'starter' ? i.access?.channel ?? null : null;
  });

  /** Fecha desde la que puede volver a cambiar de mitad; `null` = ya puede. */
  readonly channelAvailableOn = computed(() => {
    const at = this.info()?.channel_change_available_at;
    return at ? formatDay(at) : null;
  });

  readonly channelSwitchLabel = computed(() => {
    const c = this.currentChannel();
    return c ? channelSwitchCopy(otherChannel(c)).action : '';
  });

  readonly planes = PLAN_CARDS;

  /** A. La tarjeta de estado (§14 A). */
  readonly status = computed(() => {
    const info = this.info();
    return info ? statusCard(info) : null;
  });

  /** B. Las barras de uso, solo de los topes que tiene su plan (§14 B). */
  readonly bars = computed(() => {
    const info = this.info();
    return info ? usageBars(info) : [];
  });

  /** Desde el 80 % de algún tope se ofrece quitar el límite. */
  readonly nearLimit = computed(() => this.bars().some(b => b.tone !== 'ok'));

  /** La mitad que ya tenía (un Starter cancelado que vuelve): se marca de entrada en el flujo. */
  readonly lastChannel = computed(() => this.info()?.access?.channel ?? null);

  /**
   * `past_due` merece aviso pero no alarma: el periodo anterior está pagado
   * y Stripe sigue reintentando el cobro.
   */
  readonly avisoPago = computed(() => this.info()?.subscription_status === 'past_due');

  private polling?: Subscription;

  constructor() {
    // Al aplicarse un cambio de plan (desde aquí o desde un aviso), la tarjeta "Tu plan" se pone al día.
    toObservable(this.upgrades.applied).pipe(skip(1), takeUntilDestroyed()).subscribe(() => this.cargar());
  }

  ngOnInit(): void {
    // Stripe devuelve al negocio con ?suscripcion=ok o =cancelada. El estado real lo confirma el
    // webhook, no este parámetro: la URL solo dice que hay que esperar, nunca da por buena la suscripción.
    const r = this.route.snapshot.queryParamMap.get('suscripcion');
    if (r) this.clearReturnParam();

    if (r === 'ok') {
      this.activate();
      return;
    }
    if (r === 'cancelada') this.snack.info('No se realizó ningún cobro.');
    this.cargar();
  }

  cargar(): void {
    this.loading.set(true);
    this.billing.getPlan().subscribe({
      next: info => { this.info.set(info); this.loading.set(false); },
      error: () => {
        this.loading.set(false);
        this.snack.error('No se pudo cargar tu suscripción');
      },
    });
  }

  button(card: PlanCard): PlanButton {
    return planButton(card, this.info());
  }

  isCurrent(card: PlanCard): boolean {
    return isCurrentPlan(card, this.info());
  }

  /** El botón de una tarjeta: sin suscripción, primer pago (15A); con ella, subir (15B) o bajar (15C). */
  choose(card: PlanCard): void {
    const b = this.button(card);
    if (b.disabled) return;
    if (b.action === 'checkout') this.checkoutCard.set(card);
    if (b.action === 'upgrade') this.upgrades.open(card.key);
    if (b.action === 'downgrade') this.downgradeCard.set(card);
  }

  /** "Pasa a Pro para quitar el límite": el modal de mejora (15B), o el primer pago si no tiene suscripción. */
  upgradeFromUsage(): void {
    this.upgrades.open('pro');
  }

  /** Abre la confirmación para cambiar a la otra mitad (15D). */
  openChannelSwitch(): void {
    const c = this.currentChannel();
    if (c && !this.channelAvailableOn()) this.channelTarget.set(otherChannel(c));
  }

  /** La mitad cambió: la pantalla y el menú se ponen al día con la respuesta, sin otra petición. */
  onChannelChanged(info: PlanInfo): void {
    this.info.set(info);
    if (info.access) this.plan.apply(info.access);
    const c = info.access?.channel;
    this.snack.success(c ? `Listo: tu mitad ahora es ${channelName(c)}` : 'Listo: cambiaste de mitad');
  }

  /**
   * "Activando tu plan…": el pago llega por webhook unos segundos después.
   * Pregunta cada 2 s, hasta 5 veces, mientras no haya suscripción. Un
   * intento que falla (red) cuenta como intento, y se sigue preguntando.
   */
  activate(): void {
    this.polling?.unsubscribe();
    this.activation.set('waiting');
    this.loading.set(false);

    let last: PlanInfo | null = null;
    this.polling = timer(0, ACTIVATION_POLL_MS).pipe(
      take(ACTIVATION_POLL_TRIES),
      switchMap(() => this.billing.getPlan().pipe(catchError(() => EMPTY))),
      takeWhile(info => !info.has_subscription, true),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe({
      next: info => { last = info; this.info.set(info); },
      complete: () => {
        if (last?.has_subscription) this.activated(last);
        else this.activation.set('slow');
      },
    });
  }

  private activated(info: PlanInfo): void {
    this.activation.set(null);
    // El menú se redibuja ya con lo que trajo /billing/plan, y se confirma con /auth/me.
    if (info.access) this.plan.apply(info.access);
    this.plan.refresh().subscribe({ error: () => {} });
    const nombre = PLAN_CARDS.find(c => c.key === info.plan)?.nombre ?? 'nuevo';
    this.snack.success(`¡Listo! Tu plan ${nombre} está activo`);
  }

  /** Quita `?suscripcion=` de la dirección: al recargar no se vuelve a esperar ni a avisar. */
  private clearReturnParam(): void {
    this.router.navigate([], {
      relativeTo: this.route, queryParams: { suscripcion: null }, queryParamsHandling: 'merge', replaceUrl: true,
    });
  }
}
