import { Component, inject, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlanStore } from '../../core/store/plan.store';

/**
 * Pantalla completa en lugar de la caja cuando la cuenta está en solo lectura
 * (§13): así nadie empieza a capturar una venta que no podrá cobrar. El dueño
 * ve "Elegir plan"; el equipo, que le avise al dueño.
 */
@Component({
  selector: 'app-read-only-lock',
  imports: [RouterLink],
  templateUrl: './read-only-lock.component.html',
  styleUrl: './read-only-lock.component.scss',
})
export class ReadOnlyLockComponent {
  protected readonly plan = inject(PlanStore);

  /** Qué no se puede hacer, para el texto: "cobrar", "abrir la caja"… */
  readonly action = input('vender');
}
