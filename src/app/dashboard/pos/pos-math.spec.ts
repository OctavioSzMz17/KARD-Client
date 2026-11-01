/**
 * Prueba del cliente PC-06 — matemática del cobro (pos-math)
 *
 * La pantalla del punto de venta calcula el total y el cambio antes de enviar
 * la venta; el servidor los vuelve a calcular. Si los dos discreparan por un
 * centavo, el cajero vería un total y el ticket traería otro. Estas pruebas
 * fijan las mismas reglas que `orders/money.py` del backend.
 */

import { describe, expect, it } from 'vitest';

import {
  centsToApi,
  changeFor,
  computeTotals,
  discountCents,
  formatCents,
  formatMoney,
  quickAmounts,
  subtotalOf,
  toCents,
} from './pos-math';

describe('PC-06 · pos-math', () => {
  describe('toCents', () => {
    it('convierte importes comunes sin error de punto flotante', () => {
      expect(toCents('0.1')).toBe(10);
      expect(toCents('0.3')).toBe(30);
      expect(toCents('19.99')).toBe(1999);
      expect(toCents('38')).toBe(3800);
      expect(toCents('38.5')).toBe(3850);
      expect(toCents(12.5)).toBe(1250);
    });

    it('acepta símbolo, comas y espacios', () => {
      expect(toCents('$1,200.00')).toBe(120000);
      expect(toCents(' 5 ')).toBe(500);
      expect(toCents('.5')).toBe(50);
    });

    it('redondea la mitad hacia arriba, como el servidor', () => {
      expect(toCents('0.005')).toBe(1);
      expect(toCents('0.004')).toBe(0);
      expect(toCents('1.115')).toBe(112);
    });

    it('rechaza lo que no es un importe', () => {
      expect(toCents('')).toBeNull();
      expect(toCents('abc')).toBeNull();
      expect(toCents('-5')).toBeNull();
      expect(toCents('1.2.3')).toBeNull();
      expect(toCents('.')).toBeNull();
      expect(toCents(null)).toBeNull();
    });
  });

  describe('formato', () => {
    it('formatCents agrupa miles y fija dos decimales', () => {
      expect(formatCents(0)).toBe('$0.00');
      expect(formatCents(5)).toBe('$0.05');
      expect(formatCents(123450)).toBe('$1,234.50');
      expect(formatCents(-3000)).toBe('-$30.00');
    });

    it('formatMoney da formato a los importes que manda la API', () => {
      expect(formatMoney('38')).toBe('$38.00');
      expect(formatMoney('1234.5')).toBe('$1,234.50');
      expect(formatMoney('-30.00')).toBe('-$30.00');
      expect(formatMoney(null)).toBe('$0.00');
      expect(formatMoney(undefined)).toBe('$0.00');
    });

    it('centsToApi entrega el texto que acepta la API', () => {
      expect(centsToApi(1)).toBe('0.01');
      expect(centsToApi(3800)).toBe('38.00');
      expect(centsToApi(123450)).toBe('1234.50');
    });
  });

  describe('descuento', () => {
    it('porcentaje sobre el subtotal', () => {
      expect(discountCents(7600, { kind: 'percent', value: '10' })).toBe(760);
      expect(discountCents(10000, { kind: 'percent', value: '100' })).toBe(10000);
    });

    it('redondea el porcentaje a centavo hacia arriba en el medio', () => {
      // 10 % de $0.05 = $0.005 → $0.01 (con ROUND_HALF_EVEN sería $0.00)
      expect(discountCents(5, { kind: 'percent', value: '10' })).toBe(1);
      // 12.5 % de $1.00 = $0.125 → $0.13
      expect(discountCents(100, { kind: 'percent', value: '12.5' })).toBe(13);
    });

    it('monto fijo', () => {
      expect(discountCents(7600, { kind: 'amount', value: '50' })).toBe(5000);
    });

    it('sin descuento o vacío vale cero', () => {
      expect(discountCents(7600, null)).toBe(0);
      expect(discountCents(7600, { kind: 'amount', value: '  ' })).toBe(0);
    });

    it('un descuento mayor al subtotal es un error, no se recorta', () => {
      expect(() => discountCents(30000, { kind: 'amount', value: '500' })).toThrow(/no puede ser mayor/);
    });

    it('porcentajes fuera de rango son error', () => {
      expect(() => discountCents(1000, { kind: 'percent', value: '0' })).toThrow();
      expect(() => discountCents(1000, { kind: 'percent', value: '100.01' })).toThrow();
      expect(() => discountCents(1000, { kind: 'percent', value: 'x' })).toThrow();
    });
  });

  describe('totales', () => {
    const lines = [
      { price: '38.00', quantity: 2 },
      { price: '12.50', quantity: 1 },
    ];

    it('subtotal = suma de precio × cantidad', () => {
      expect(subtotalOf(lines)).toBe(8850);
      expect(subtotalOf([])).toBe(0);
    });

    it('total = subtotal − descuento + propina', () => {
      const t = computeTotals(lines, { kind: 'percent', value: '10' }, '15');
      expect(t).toEqual({ subtotal: 8850, discount: 885, tip: 1500, total: 9465, error: null });
    });

    it('sin descuento ni propina el total es el subtotal', () => {
      expect(computeTotals(lines, null, '').total).toBe(8850);
    });

    it('un descuento inválido se reporta y no altera el total', () => {
      const t = computeTotals(lines, { kind: 'amount', value: '999' }, '');
      expect(t.error).toMatch(/no puede ser mayor/);
      expect(t.discount).toBe(0);
      expect(t.total).toBe(8850);
    });

    it('una propina inválida se reporta', () => {
      expect(computeTotals(lines, null, 'abc').error).toMatch(/propina/);
    });
  });

  describe('cambio', () => {
    it('recibido − total', () => {
      expect(changeFor(9465, '100')).toEqual({ change: 535, missing: 0, enough: true });
    });

    it('pago exacto: cambio cero y alcanza', () => {
      expect(changeFor(9465, '94.65')).toEqual({ change: 0, missing: 0, enough: true });
    });

    it('recibir de menos: dice cuánto falta y no alcanza', () => {
      expect(changeFor(9465, '90')).toEqual({ change: 0, missing: 465, enough: false });
    });

    it('sin monto escrito no alcanza', () => {
      expect(changeFor(9465, '')).toEqual({ change: 0, missing: 9465, enough: false });
    });
  });

  describe('montos rápidos', () => {
    it('ofrece el total exacto y los billetes que lo cubren', () => {
      expect(quickAmounts(9465)).toEqual([9465, 10000, 20000, 50000]);
    });

    it('nunca ofrece un monto menor al total', () => {
      for (const total of [1, 2000, 2001, 99999, 250000]) {
        expect(quickAmounts(total).every(n => n >= total)).toBe(true);
      }
    });

    it('con un total mayor a todos los billetes sigue ofreciendo opciones', () => {
      const options = quickAmounts(253000);
      expect(options).toContain(253000);
      expect(options.length).toBeGreaterThan(1);
    });

    it('sin total no ofrece nada', () => {
      expect(quickAmounts(0)).toEqual([]);
    });
  });
});
