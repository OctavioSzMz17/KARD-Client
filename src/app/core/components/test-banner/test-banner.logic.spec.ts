import { describe, expect, it } from 'vitest';
import { visibleBannerHeight } from './test-banner.logic';

describe('visibleBannerHeight', () => {
  it('arriba de la página se ve completo', () => {
    expect(visibleBannerHeight(40, 0)).toBe(40);
  });

  it('al bajar se va quedando fuera de la vista', () => {
    expect(visibleBannerHeight(40, 15)).toBe(25);
  });

  it('cuando ya salió, no queda nada (nunca negativo)', () => {
    expect(visibleBannerHeight(40, 40)).toBe(0);
    expect(visibleBannerHeight(40, 900)).toBe(0);
  });

  it('un rebote por arriba (scroll negativo) no lo agranda', () => {
    expect(visibleBannerHeight(40, -30)).toBe(40);
  });

  it('redondea: las barras fijas trabajan en píxeles enteros', () => {
    expect(visibleBannerHeight(40.4, 0)).toBe(40);
  });
});
