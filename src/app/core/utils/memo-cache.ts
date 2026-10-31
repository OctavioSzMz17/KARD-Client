import { Observable, catchError, shareReplay, throwError } from 'rxjs';

/**
 * Cache en memoria de GETs públicos, para servicios que piden lo mismo varias
 * veces mientras alguien navega (la tienda, explorar).
 *
 * Guarda la petición, no solo el resultado: si dos componentes piden lo mismo
 * a la vez, viaja una sola. Un error nunca se guarda, para que reintentar
 * vuelva a intentarlo. Cada entrada vive `ttlMs` (por defecto un minuto, el
 * mismo que el servidor declara en `Cache-Control`).
 */
export class MemoCache {
  private entries = new Map<string, { at: number; request$: Observable<unknown> }>();

  constructor(
    private readonly ttlMs = 60_000,
    /** Las búsquedas distintas llenarían el mapa: al pasarse del tope se suelta la más vieja. */
    private readonly maxEntries = 60,
  ) {}

  get<T>(key: string, request: () => Observable<T>): Observable<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.request$ as Observable<T>;

    if (this.entries.size >= this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }

    const request$ = request().pipe(
      catchError(err => {
        this.entries.delete(key);
        return throwError(() => err);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.entries.set(key, { at: Date.now(), request$ });
    return request$;
  }

  clear(): void {
    this.entries.clear();
  }
}
