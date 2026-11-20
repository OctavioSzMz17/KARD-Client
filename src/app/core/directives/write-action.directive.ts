import { Directive, ElementRef, computed, inject, input } from '@angular/core';
import { PlanStore } from '../store/plan.store';

/** Lo que dice el tooltip de una acción bloqueada en solo lectura (§13). */
export const READ_ONLY_HINT = 'Disponible al elegir un plan';

/**
 * Marca un botón (o un `<select>`) que MODIFICA datos: Guardar, Nuevo,
 * Eliminar, Cobrar… En solo lectura (prueba vencida o suscripción cancelada)
 * se deshabilita con el tooltip "Disponible al elegir un plan". Consultar,
 * filtrar, imprimir o descargar no llevan esta marca y siguen funcionando.
 *
 * La directiva es dueña de `disabled`: si el control ya se deshabilitaba por su
 * cuenta, esa condición pasa a `[appWriteDisabled]` en lugar de `[disabled]`.
 *
 * No es la protección: si algo se escapa, el servidor responde `402 read_only`
 * y el interceptor muestra el aviso de elegir un plan.
 */
@Directive({
  selector: '[appWrite]',
  host: {
    // Como atributo: la directiva no sabe si es <button> o <select>, y en los dos deshabilita igual.
    '[attr.disabled]': 'disabled() ? "" : null',
    '[attr.title]': 'title()',
    '[class.write-locked]': 'locked()',
  },
})
export class WriteActionDirective {
  private plan = inject(PlanStore);

  /** Lo que ya deshabilitaba el control (cargando, sin cambios…). */
  readonly appWriteDisabled = input(false);

  /** El `title` que el control traía escrito: se conserva fuera de solo lectura. */
  private readonly ownTitle = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.getAttribute('title');

  protected readonly locked = this.plan.readOnly;
  protected readonly disabled = computed(() => this.locked() || this.appWriteDisabled());
  protected readonly title = computed(() => (this.locked() ? READ_ONLY_HINT : this.ownTitle));
}
