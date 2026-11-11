/**
 * Entorno de producción — usado por `ng build` (configuración por defecto).
 *
 * En desarrollo `angular.json` sustituye este archivo por
 * `environment.development.ts` mediante `fileReplacements`.
 */
const serverUrl = 'https://kard-ex9x.onrender.com';

export const environment = {
  /** Fase de pruebas: muestra el aviso al inicio de todas las pantallas. Ponlo en `false` al salir a producción. */
  testPhase: true,

  production: true,

  /** Raíz del backend, sin prefijo. Para rutas fuera de la API (ej. `/s/:slug`). */
  serverUrl,

  /** Base de la API versionada. */
  apiUrl: `${serverUrl}/api/v1`,
};
