import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { Channel, PlanAccess } from '../models/plan.models';
import { PERM, Permission } from '../permissions';
import { AuthService } from '../services/auth.service';
import {
  DEV_PLAN_PRESETS, PLAN_OVERRIDE_KEY, hasChannel, homeRouteFor, parsePlanOverride,
} from '../plan-logic';

/** Si se permite sobrescribir el plan desde `localStorage`. Solo fuera de producción. */
export const PLAN_DEV_OVERRIDE = new InjectionToken<boolean>('PLAN_DEV_OVERRIDE', {
  providedIn: 'root',
  factory: () => !environment.production,
});

/**
 * El plan del negocio para la pantalla.
 *
 * Lo lee de `/auth/me` (lo recibe todo el equipo, no solo el dueño) y lo guarda
 * en la sesión junto a `permissions`, así que al recargar la página el menú ya
 * sale correcto antes de volver a preguntar. Solo sirve para mostrar u ocultar:
 * el servidor vuelve a aplicar el plan en cada petición.
 *
 * En desarrollo se puede sobrescribir para ver cada estado de la guía sin pasar
 * por Stripe: `localStorage.znvx_plan_dev = 'starter-pos'` y recargar, o desde
 * la consola `znvxPlan('starter-pos')` (sin argumento, lista los estados;
 * `znvxPlan(null)` vuelve al plan real). Solo cambia lo que se VE: el servidor
 * sigue respondiendo según el plan real.
 */
@Injectable({ providedIn: 'root' })
export class PlanStore {
  private auth = inject(AuthService);
  private devOverride = inject(PLAN_DEV_OVERRIDE);

  private override = signal<PlanAccess | null>(
    this.devOverride ? parsePlanOverride(localStorage.getItem(PLAN_OVERRIDE_KEY)) : null,
  );

  /** El plan vigente para la pantalla. `null` = todavía no se sabe (sesión sin `/auth/me`). */
  readonly access = computed<PlanAccess | null>(() => this.override() ?? this.auth.profile()?.plan ?? null);

  /** Se está viendo un estado de ejemplo, no el plan real. */
  readonly overridden = computed(() => this.override() !== null);

  readonly state = computed(() => this.access()?.state ?? null);
  readonly plan = computed(() => this.access()?.plan ?? null);
  readonly channel = computed(() => this.access()?.channel ?? null);

  // Mientras no se sepa el plan se muestra todo (ver `hasChannel`).
  readonly hasPos = computed(() => hasChannel(this.access(), 'pos'));
  readonly hasStore = computed(() => hasChannel(this.access(), 'store'));
  readonly storePublic = computed(() => this.access()?.store_public ?? true);
  readonly delivery = computed(() => this.access()?.delivery ?? true);
  readonly salesExport = computed(() => this.access()?.sales_export ?? true);
  readonly readOnly = computed(() => this.access()?.read_only ?? false);

  readonly trialDaysLeft = computed(() => this.access()?.trial_days_left ?? null);
  readonly trialEndsAt = computed(() => this.access()?.trial_ends_at ?? null);
  readonly maxProducts = computed(() => this.access()?.max_products ?? null);
  readonly maxUsers = computed(() => this.access()?.max_users ?? null);

  /**
   * Quien administra el cobro. El dueño ve oportunidades (candados, precios);
   * el resto del equipo solo instrucciones ("pídele al dueño").
   */
  readonly isOwner = computed(() => this.auth.can(PERM.billingManage));

  constructor() {
    if (this.devOverride) this.exposeConsoleHelper();
  }

  /** ¿El plan incluye esta mitad? */
  has(channel: Channel): boolean {
    return channel === 'pos' ? this.hasPos() : this.hasStore();
  }

  /** Permiso del puesto Y, si se indica, la mitad del plan. Ej.: Cobrar = `pos:sell` + `pos`. */
  canUse(permission: Permission, channel?: Channel): boolean {
    return this.auth.can(permission) && (!channel || this.has(channel));
  }

  /** La primera pantalla que le corresponde a la sesión, contando su plan. */
  homeRoute(): string {
    return homeRouteFor(p => this.auth.can(p), c => this.has(c));
  }

  /**
   * Vuelve a preguntar el plan al servidor (`/auth/me`). Úsalo al regresar de
   * pagar o tras cualquier cambio que llegue por webhook.
   */
  refresh(): Observable<PlanAccess | null> {
    return this.auth.refreshProfile().pipe(map(me => me.plan ?? null));
  }

  /**
   * Aplica un plan que ya trajo otra respuesta (el `access` de `change-plan` o
   * de `/billing/plan`), sin otra petición: el menú se redibuja al instante.
   */
  apply(access: PlanAccess): void {
    this.auth.setPlan(access);
  }

  /**
   * Solo en desarrollo: muestra un estado de ejemplo (nombre de
   * `DEV_PLAN_PRESETS` o un `PlanAccess` parcial). `null` vuelve al plan real.
   */
  setOverride(value: string | Partial<PlanAccess> | null): void {
    if (!this.devOverride) return;
    if (value === null) {
      localStorage.removeItem(PLAN_OVERRIDE_KEY);
      this.override.set(null);
      return;
    }
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const parsed = parsePlanOverride(raw);
    if (!parsed) return;
    localStorage.setItem(PLAN_OVERRIDE_KEY, raw);
    this.override.set(parsed);
  }

  private exposeConsoleHelper(): void {
    (globalThis as Record<string, unknown>)['znvxPlan'] = (value?: string | Partial<PlanAccess> | null) => {
      if (value === undefined) {
        console.info(`Estados de ejemplo: ${Object.keys(DEV_PLAN_PRESETS).join(', ')}. znvxPlan(null) vuelve al plan real.`);
        return this.access();
      }
      this.setOverride(value);
      return this.access();
    };
  }
}
