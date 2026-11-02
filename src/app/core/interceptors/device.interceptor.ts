import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { activeDeviceToken } from '../device-logic';

/**
 * Manda el token del equipo (`X-Device-Token`) en cada petición a la API de
 * KARD cuando este navegador es una caja autorizada.
 *
 * Lee el almacenamiento directamente y no a través de un servicio: el servicio
 * usa HttpClient, y un interceptor que dependa de HttpClient es una
 * dependencia circular.
 *
 * Solo viaja a la API propia, nunca a otro dominio.
 */
export const deviceInterceptor: HttpInterceptorFn = (req, next) => {
  if (!req.url.startsWith(environment.apiUrl)) return next(req);

  const token = activeDeviceToken();
  return next(token ? req.clone({ setHeaders: { 'X-Device-Token': token } }) : req);
};
