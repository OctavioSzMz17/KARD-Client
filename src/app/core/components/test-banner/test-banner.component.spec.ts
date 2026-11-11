import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { environment } from '../../../../environments/environment';
import { TestBannerComponent } from './test-banner.component';

describe('TestBannerComponent', () => {
  it('avisa que es fase de pruebas y que no se usen datos reales', async () => {
    const fixture = TestBed.createComponent(TestBannerComponent);
    await fixture.whenStable();

    const el: HTMLElement = fixture.nativeElement;
    expect(environment.testPhase).toBe(true);
    expect(el.querySelector('[role="status"]')).not.toBeNull();
    expect(el.textContent).toContain('Fase de pruebas');
    expect(el.textContent).toContain('no uses tarjetas ni datos personales reales');
    fixture.destroy();
  });

  it('deja su altura visible en una variable CSS y la quita al desaparecer', async () => {
    const fixture = TestBed.createComponent(TestBannerComponent);
    await fixture.whenStable();
    expect(document.documentElement.style.getPropertyValue('--aviso-visible')).toMatch(/^\d+px$/);

    fixture.destroy();
    expect(document.documentElement.style.getPropertyValue('--aviso-visible')).toBe('');
  });
});
