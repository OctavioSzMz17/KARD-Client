import { describe, expect, it } from 'vitest';
import { sizedImage } from './image-url';

const ORIGINAL = 'https://res.cloudinary.com/dnyz3kymq/image/upload/v1794977304/nhhcrubvn15422u3dy6g.jpg';

describe('sizedImage', () => {
  it('pide la foto de Cloudinary achicada, en el formato más ligero', () => {
    expect(sizedImage(ORIGINAL, 480)).toBe(
      'https://res.cloudinary.com/dnyz3kymq/image/upload/f_auto,q_auto,c_limit,w_480/v1794977304/nhhcrubvn15422u3dy6g.jpg',
    );
  });

  it('redondea el ancho', () => {
    expect(sizedImage(ORIGINAL, 447.6)).toContain(',w_448/');
  });

  it('no toca una dirección que ya trae transformación', () => {
    const conTransformacion = 'https://res.cloudinary.com/dnyz3kymq/image/upload/w_200/v1/foto.jpg';
    expect(sizedImage(conTransformacion, 480)).toBe(conTransformacion);
  });

  it('deja igual las fotos de otros sitios', () => {
    const ajena = 'https://images.recetasmexas.com/images/recipes/1770327937117-koued7.webp';
    expect(sizedImage(ajena, 480)).toBe(ajena);
  });

  it('sin foto devuelve vacío', () => {
    expect(sizedImage(null, 480)).toBe('');
    expect(sizedImage(undefined, 480)).toBe('');
  });
});
