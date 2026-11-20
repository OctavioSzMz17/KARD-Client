import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { Injector, inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { asPlanError } from '../plan-notice.logic';
import { PlanNoticeService } from '../services/plan-notice.service';

/**
 * Para una petición cuya pantalla ya maneja los errores del plan por su cuenta
 * (p. ej. el modal de cambio de plan): el interceptor no abre su aviso.
 */
export const SKIP_PLAN_NOTICE = new HttpContextToken<boolean>(() => false);

/**
 * Traduce los errores del plan de la API propia (402 con `code`, y los 409 de
 * cobro) al aviso de la guía. El error sigue su camino: quien llamó apaga su
 * spinner y conserva lo capturado, igual que con cualquier otro error.
 *
 * Los demás 402/409 (p. ej. el 409 de falta de stock del carrito) no se tocan.
 */
export const planErrorInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl) || req.context.get(SKIP_PLAN_NOTICE)) return next(req);

  // El servicio se pide hasta que hay un error: depende (vía el plan) de
  // HttpClient, y pedirlo al construir el interceptor sería circular.
  const injector = inject(Injector);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const planError = asPlanError(err.status, err.error);
        if (planError) injector.get(PlanNoticeService).handle(planError);
      }
      return throwError(() => err);
    }),
  );
};
