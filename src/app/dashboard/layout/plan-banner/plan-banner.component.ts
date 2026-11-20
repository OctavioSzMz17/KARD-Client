import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { BillingService } from '../../../core/services/billing.service';
import { PlanStore } from '../../../core/store/plan.store';
import { bannerFor } from './plan-banner.logic';

/** Dónde se recuerda el aviso que se cerró: solo dura la sesión del navegador. */
const DISMISSED_KEY = 'znvx_banner_cerrado';
const SUBSCRIPTION_URL = '/dashboard/suscripcion';

/**
 * Banner superior del panel con el estado de la cuenta (§11): prueba, prueba
 * por vencer, vencida y pago atrasado. Uno solo a la vez. Los avisos que no son
 * fijos se pueden cerrar hasta la siguiente sesión; si cambia el estado (otro
 * número de días, por ejemplo), vuelve a salir.
 */
@Component({
  selector: 'app-plan-banner',
  imports: [RouterLink],
  templateUrl: './plan-banner.component.html',
  styleUrl: './plan-banner.component.scss',
})
export class PlanBannerComponent {
  private plan = inject(PlanStore);
  private billing = inject(BillingService);
  private router = inject(Router);

  readonly subscriptionUrl = SUBSCRIPTION_URL;

  /**
   * El estado de Stripe (para `past_due`) no viaja en `/auth/me`: solo el dueño
   * puede pedirlo, y se pide una vez, cuando la cuenta está activa.
   */
  private readonly subscriptionStatus = signal<string | null>(null);
  private statusRequested = false;

  private readonly dismissed = signal<string | null>(sessionStorage.getItem(DISMISSED_KEY));

  private readonly url = toSignal(
    this.router.events.pipe(filter(e => e instanceof NavigationEnd), map(() => this.router.url), startWith(this.router.url)),
    { initialValue: this.router.url },
  );

  readonly banner = computed(() => {
    const b = bannerFor(this.plan.access(), this.subscriptionStatus(), this.plan.isOwner());
    return b && !b.fixed && b.key === this.dismissed() ? null : b;
  });

  /** En Suscripción el botón sobra: ya está ahí. */
  readonly showAction = computed(() => !!this.banner()?.action && !this.url().startsWith(SUBSCRIPTION_URL));

  constructor() {
    effect(() => {
      if (this.statusRequested || !this.plan.isOwner() || this.plan.state() !== 'active') return;
      this.statusRequested = true;
      untracked(() => this.billing.getPlan().subscribe({
        next: info => this.subscriptionStatus.set(info.subscription_status),
        error: () => {},   // sin el estado de Stripe simplemente no hay aviso de pago
      }));
    });
  }

  dismiss(): void {
    const b = this.banner();
    if (!b || b.fixed) return;
    sessionStorage.setItem(DISMISSED_KEY, b.key);
    this.dismissed.set(b.key);
  }
}
