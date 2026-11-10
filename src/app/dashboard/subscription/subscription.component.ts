import { DatePipe, TitleCasePipe } from '@angular/common';
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { BillingService, Plan, PlanInfo } from '../../core/services/billing.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { BRAND_NAME } from '../../shared/brand';

/** Un plan tal como se presenta al negocio. */
interface PlanCard {
  key: Plan;
  nombre: string;
  precio: number;
  resumen: string;
  incluye: string[];
  destacado?: boolean;
}

@Component({
  selector: 'app-subscription',
  imports: [DatePipe, TitleCasePipe],
  templateUrl: './subscription.component.html',
  styleUrl: './subscription.component.scss',
})
export class SubscriptionComponent implements OnInit {
  /** Nombre del producto en pantalla (ver shared/brand.ts). */
  readonly brand = BRAND_NAME;
  private billing = inject(BillingService);
  private snack   = inject(SnackbarService);
  private route   = inject(ActivatedRoute);

  info      = signal<PlanInfo | null>(null);
  loading   = signal(true);
  // Qué plan se está contratando; sirve para poner solo ese botón en espera.
  enviando  = signal<Plan | null>(null);

  /**
   * Los precios se repiten aquí solo para mostrarlos. El importe que de
   * verdad se cobra es el del precio configurado en Stripe — si cambias uno
   * allá, esto es solo texto y hay que actualizarlo a mano.
   */
  readonly planes: PlanCard[] = [
    {
      key: 'starter', nombre: 'Starter', precio: 299,
      resumen: 'Para negocios que empiezan.',
      incluye: ['Hasta 50 productos', 'Tienda pública con tu marca', 'Inventario y alertas de stock bajo', 'Punto de venta'],
    },
    {
      key: 'pro', nombre: 'Pro', precio: 599, destacado: true,
      resumen: 'Para quien ya vende todos los días.',
      incluye: ['Productos ilimitados', 'Recetas con descuento en cascada', 'Reporte de ventas descargable', 'Envíos a domicilio', 'Varios usuarios'],
    },
    {
      key: 'enterprise', nombre: 'Enterprise', precio: 1199,
      resumen: 'Para cadenas con varias sucursales.',
      incluye: ['Todo lo de Pro', 'Varias sucursales', 'Soporte prioritario', 'Acceso anticipado a nuevas funciones'],
    },
  ];

  /** Texto legible del estado que manda Stripe. */
  readonly estadoLabel = computed(() => {
    const s = this.info()?.subscription_status ?? 'none';
    return {
      none: 'Sin suscripción',
      trialing: 'En periodo de prueba',
      active: 'Activa',
      past_due: 'Pago pendiente',
      canceled: 'Cancelada',
      unpaid: 'Sin pagar',
      paused: 'En pausa',
      incomplete: 'Incompleta',
      incomplete_expired: 'Expirada',
    }[s] ?? s;
  });

  readonly planActual = computed(() => this.info()?.plan ?? null);

  /**
   * `past_due` merece aviso pero no alarma: el periodo anterior está pagado
   * y Stripe sigue reintentando el cobro.
   */
  readonly avisoPago = computed(() => this.info()?.subscription_status === 'past_due');

  ngOnInit(): void {
    // Stripe devuelve al negocio con ?suscripcion=ok tras pagar. El estado
    // real lo confirma el webhook, no este parámetro: la URL solo sirve para
    // avisar, nunca para dar por buena una suscripción.
    const r = this.route.snapshot.queryParamMap.get('suscripcion');
    if (r === 'ok')        this.snack.success('Pago recibido. La suscripción se activa en unos segundos.');
    if (r === 'cancelada') this.snack.info('Pago cancelado. No se te cobró nada.');

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

  contratar(plan: Plan): void {
    if (this.enviando()) return;
    this.enviando.set(plan);

    this.billing.checkout(plan).subscribe({
      next: res => { window.location.href = res.checkout_url; },   // se va a Stripe
      error: err => {
        this.enviando.set(null);
        // 503 = el cobro no está configurado en este entorno; vale la pena
        // distinguirlo de un error del negocio para no confundir a nadie.
        const msg = err?.status === 503
          ? (err?.error?.error ?? 'El cobro no está disponible todavía')
          : (err?.error?.error ?? 'No se pudo iniciar el pago');
        this.snack.error(msg);
      },
    });
  }
}
