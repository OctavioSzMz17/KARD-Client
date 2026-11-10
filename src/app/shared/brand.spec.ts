import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BRAND_NAME } from './brand';

/** Todas las plantillas .html de la aplicación. */
function plantillas(dir: string): string[] {
  return readdirSync(dir).flatMap(nombre => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return plantillas(ruta);
    return ruta.endsWith('.html') ? [ruta] : [];
  });
}

describe('marca', () => {
  it('el nombre del producto existe y no está vacío', () => {
    expect(BRAND_NAME.trim().length).toBeGreaterThan(0);
  });

  it('ninguna pantalla escribe el nombre a mano: lo toma de BRAND_NAME', () => {
    const sueltos = plantillas(join(process.cwd(), 'src', 'app'))
      // Restos de las pantallas viejas de acceso (ya no se usan ni están en git).
      .filter(ruta => !/[\/]auth[\/](login|register)[\/]/.test(ruta))
      .filter(ruta => readFileSync(ruta, 'utf-8').includes(BRAND_NAME));
    expect(sueltos, `Escribe {{ brand }} en vez del nombre: ${sueltos.join(', ')}`).toEqual([]);
  });
});
