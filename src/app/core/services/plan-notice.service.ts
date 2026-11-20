import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NoticeAction, PlanApiError, PlanNotice, noticeFor } from '../plan-notice.logic';
import { PlanStore } from '../store/plan.store';
import { SnackbarService } from './snackbar.service';
import { UpgradeService } from './upgrade.service';

const ROUTE: Partial<Record<NoticeAction, string>> = {
  plans: '/dashboard/suscripcion',
  products: '/dashboard/products',
  team: '/dashboard/equipo',
};

/**
 * El modal de avisos del plan: uno a la vez, encima de cualquier pantalla. Lo
 * abren el interceptor (errores 402/409), el guard y los candados del menú.
 */
@Injectable({ providedIn: 'root' })
export class PlanNoticeService {
  private router = inject(Router);
  private plan = inject(PlanStore);
  private snack = inject(SnackbarService);
  private upgrades = inject(UpgradeService);

  readonly current = signal<PlanNotice | null>(null);

  show(notice: PlanNotice): void {
    this.current.set(notice);
    // El modal ya lo explica: el toast de error de quien llamó diría lo mismo.
    this.snack.muteErrors(true);
  }

  close(): void {
    this.current.set(null);
    this.snack.muteErrors(false);
  }

  run(action: NoticeAction): void {
    this.close();
    // "Pasar a Pro" abre el modal de mejora encima de la pantalla: lo capturado no se pierde.
    if (action === 'upgrade') return this.upgrades.open('pro');
    const route = ROUTE[action];
    if (route) this.router.navigateByUrl(route);
  }

  /**
   * Un error del plan que llegó del servidor. Si choca con el plan (402), la
   * pantalla tenía un plan viejo: se vuelve a preguntar para que el menú y los
   * avisos se pongan al día.
   */
  handle(error: PlanApiError): void {
    if (error.status === 402 || error.body.code === 'subscription_exists') {
      this.plan.refresh().subscribe({ error: () => {} });
    }
    const notice = noticeFor(error, this.plan.isOwner());
    if (notice) this.show(notice);
  }
}
