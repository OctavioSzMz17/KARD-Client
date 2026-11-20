import { Component, ElementRef, HostListener, effect, inject, viewChild } from '@angular/core';
import { PlanNoticeService } from '../../services/plan-notice.service';

/**
 * El modal de avisos del plan (límite alcanzado, función de Pro, solo lectura).
 * Vive en la raíz de la app para cubrir cualquier pantalla, también la caja registradora.
 */
@Component({
  selector: 'app-plan-notice',
  templateUrl: './plan-notice.component.html',
  styleUrl: './plan-notice.component.scss',
})
export class PlanNoticeComponent {
  protected readonly notices = inject(PlanNoticeService);
  protected readonly notice = this.notices.current;

  private readonly primary = viewChild<ElementRef<HTMLButtonElement>>('primary');

  constructor() {
    // Al abrirse, el foco va al botón principal (teclado y lector de pantalla).
    effect(() => this.primary()?.nativeElement.focus());
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.notice()) this.notices.close();
  }
}
