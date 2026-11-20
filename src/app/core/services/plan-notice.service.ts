import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NoticeAction, PlanApiError, PlanNotice, noticeFor } from '../plan-notice.logic';
import { PlanStore } from '../store/plan.store';
import { SnackbarService } from './snackbar.service';

const ROUTE: Partial<Record<NoticeAction, string>> = {
  plans: '/dashboard/suscripcion',
  // Hasta que exista el modal de mejora (flujo 15B), "Pasar a Pro" lleva a Suscripción.
  upgrade: '/dashboard/suscripcion',
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
