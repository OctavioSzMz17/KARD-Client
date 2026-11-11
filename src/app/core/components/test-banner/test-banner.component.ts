import { Component, DestroyRef, ElementRef, afterNextRender, inject } from '@angular/core';
import { environment } from '../../../../environments/environment';
import { BANNER_CSS_VAR, visibleBannerHeight } from './test-banner.logic';

/**
 * Aviso al inicio de la página mientras el producto está en fase de pruebas.
 *
 * Se enciende y apaga con `environment.testPhase`: al salir a producción de verdad se pone en
 * `false` y desaparece de todas las pantallas, sin tocar nada más.
 */
@Component({
  selector: 'app-test-banner',
  templateUrl: './test-banner.component.html',
  styleUrl: './test-banner.component.scss'
})
export class TestBannerComponent {
  protected readonly enabled = environment.testPhase;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    if (!this.enabled) return;

    afterNextRender(() => {
      const root = document.documentElement;
      let frame = 0;
      let destroyed = false;

      const update = () => {
        frame = 0;
        if (destroyed) return;
        root.style.setProperty(BANNER_CSS_VAR, `${visibleBannerHeight(this.host.nativeElement.offsetHeight, window.scrollY)}px`);
      };
      const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };

      update();
      window.addEventListener('scroll', schedule, { passive: true });
      // Si el texto se parte en más líneas (pantalla angosta), la altura cambia sin que haya scroll.
      const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
      resize?.observe(this.host.nativeElement);

      this.destroyRef.onDestroy(() => {
        destroyed = true;
        window.removeEventListener('scroll', schedule);
        resize?.disconnect();
        if (frame) cancelAnimationFrame(frame);
        root.style.removeProperty(BANNER_CSS_VAR);
      });
    });
  }
}
