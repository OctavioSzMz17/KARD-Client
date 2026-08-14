/** Entorno de desarrollo — usado por `ng serve` y `ng build --configuration development`. */
const serverUrl = 'http://localhost:8000';

export const environment = {
  production: false,

  /** Raíz del backend, sin prefijo. Para rutas fuera de la API (ej. `/s/:slug`). */
  serverUrl,

  /** Base de la API versionada. */
  apiUrl: `${serverUrl}/api/v1`,
};
