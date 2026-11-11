/**
 * Cuánto del aviso se ve todavía, dado cuánto mide y cuánto se ha desplazado la página.
 *
 * El aviso va al inicio de la página y se va con ella al bajar. La barra de la tienda, que es fija,
 * necesita saber cuánto del aviso queda a la vista para no taparlo (ni dejar un hueco cuando ya se fue).
 */
export function visibleBannerHeight(bannerHeight: number, scrollY: number): number {
  return Math.max(0, Math.round(bannerHeight - Math.max(0, scrollY)));
}

/** La variable CSS que las barras fijas leen: `top: var(--aviso-visible, 0px)`. */
export const BANNER_CSS_VAR = '--aviso-visible';
