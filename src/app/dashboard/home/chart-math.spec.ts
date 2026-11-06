/**
 * Prueba del cliente PC-18 — Cuentas de las gráficas del Dashboard (chart-math)
 *
 * Las gráficas se dibujan con lo que de verdad vendió el negocio. Estas pruebas fijan cómo se
 * traduce una serie de importes a un trazo, que un día sin ventas sea un dato (el piso) y que
 * los nombres de los días sean los del negocio y no los de Greenwich.
 */

import { describe, expect, it } from 'vitest';

import { areaPath, barPercent, dayLabels, linePath, seriesPoints } from './chart-math';

describe('PC-18 · chart-math', () => {
  describe('puntos de la serie', () => {
    it('el valor más alto queda arriba (con un margen) y el cero, en el piso', () => {
      const [a, b, c] = seriesPoints([0, 50, 100], 280, 100);
      expect(a.y).toBe(100);
      expect(c.y).toBe(8);                         // margen superior
      expect(b.y).toBeGreaterThan(c.y);
      expect(b.y).toBeLessThan(a.y);
    });

    it('reparte los días parejo de izquierda a derecha, de borde a borde', () => {
      const xs = seriesPoints([1, 2, 3, 4, 5, 6, 7], 280, 100).map(p => p.x);
      expect(xs[0]).toBe(0);
      expect(xs[6]).toBe(280);
      expect(xs[3]).toBe(140);
    });

    it('sin ventas en ningún día es una línea plana en el piso, no una curva inventada', () => {
      const ys = seriesPoints([0, 0, 0, 0, 0, 0, 0], 280, 100).map(p => p.y);
      expect(new Set(ys)).toEqual(new Set([100]));
    });

    it('un solo día con ventas se ve como un pico entre días en cero', () => {
      const ys = seriesPoints([0, 0, 90, 0, 0], 280, 100).map(p => p.y);
      expect(ys).toEqual([100, 100, 8, 100, 100]);
    });

    it('es proporcional: el doble de ventas llega el doble de alto', () => {
      const [, medio, tope] = seriesPoints([0, 50, 100], 280, 100);
      expect(100 - medio.y).toBeCloseTo((100 - tope.y) / 2, 5);
    });

    it('un importe negativo no hace que la línea se salga del cuadro', () => {
      const ys = seriesPoints([-50, 100], 280, 100).map(p => p.y);
      expect(ys.every(y => y >= 0 && y <= 100)).toBe(true);
    });

    it('sin datos no hay puntos', () => {
      expect(seriesPoints([], 280, 100)).toEqual([]);
    });

    it('un solo dato queda al centro', () => {
      expect(seriesPoints([10], 280, 100)[0].x).toBe(140);
    });

    it('no cambia entre una llamada y otra (nada aleatorio)', () => {
      const serie = [120.5, 0, 340, 80, 0, 0, 500];
      expect(linePath(serie, 280, 100)).toBe(linePath(serie, 280, 100));
    });
  });

  describe('trazos', () => {
    it('la línea empieza con M y sigue con L', () => {
      expect(linePath([0, 100], 280, 100)).toBe('M0.0,100.0 L280.0,8.0');
    });

    it('sin datos el trazo está vacío', () => {
      expect(linePath([], 280, 100)).toBe('');
      expect(areaPath([], 280, 100)).toBe('');
    });

    it('el área cierra bajando al piso por los dos lados', () => {
      expect(areaPath([0, 100], 280, 100)).toBe('M0.0,100.0 L280.0,8.0 L280,100 L0,100 Z');
    });
  });

  describe('nombres de los días', () => {
    // 3 de noviembre de 2026 es martes.
    const semana = ['2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'];

    it('cada día lleva su nombre y el último dice "Hoy"', () => {
      expect(dayLabels(semana)).toEqual(['Mié', 'Jue', 'Vie', 'Sáb', 'Dom', 'Lun', 'Hoy']);
    });

    it('el nombre sale de la fecha del negocio, sin correrse un día por la zona horaria', () => {
      // `new Date('2026-11-02')` es UTC: en México (UTC-6) sería el domingo 1. Aquí debe ser lunes.
      expect(dayLabels(['2026-11-02', '2026-11-03'])[0]).toBe('Lun');
    });

    it('un solo día es "Hoy"', () => {
      expect(dayLabels(['2026-11-03'])).toEqual(['Hoy']);
    });

    it('cruza el fin de mes y de año sin romperse', () => {
      expect(dayLabels(['2026-12-31', '2027-01-01', '2027-01-02'])).toEqual(['Jue', 'Vie', 'Hoy']);
    });

    it('sin días no hay etiquetas', () => {
      expect(dayLabels([])).toEqual([]);
    });
  });

  describe('barras de lo más vendido', () => {
    it('la mayor ocupa todo el ancho y las demás, su proporción', () => {
      expect(barPercent(9, 9)).toBe(100);
      expect(barPercent(3, 9)).toBe(33);
    });

    it('algo vendido nunca desaparece: una barra mínima', () => {
      expect(barPercent(1, 1000)).toBe(6);
    });

    it('sin unidades, sin barra', () => {
      expect(barPercent(0, 9)).toBe(0);
      expect(barPercent(5, 0)).toBe(0);
    });
  });
});
