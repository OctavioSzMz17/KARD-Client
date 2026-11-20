import { Injectable, signal } from '@angular/core';
import { Plan } from '../models/plan.models';

/**
 * Abre el modal de mejora (flujo 15B) desde cualquier pantalla: el botón
 * "Subir a…" de Suscripción, el candado del menú o el aviso de un límite.
 * El modal vive en la raíz, así que lo que la persona estaba capturando no se
 * pierde: al terminar vuelve a su formulario.
 */
@Injectable({ providedIn: 'root' })
export class UpgradeService {
  /** El plan al que quiere subir; `null` = modal cerrado. */
  readonly target = signal<Plan | null>(null);

  /** Sube cada vez que un cambio de plan se aplica, para que Suscripción se recargue. */
  readonly applied = signal(0);

  open(plan: Plan = 'pro'): void {
    this.target.set(plan);
  }

  close(): void {
    this.target.set(null);
  }

  markApplied(): void {
    this.applied.update(n => n + 1);
  }
}
