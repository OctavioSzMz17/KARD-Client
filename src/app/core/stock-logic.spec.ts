import { describe, expect, it } from 'vitest';
import {
  StockItem, lowStock, outOfStock, stockColor, stockDetail, stockLevel, stockTracked, totalStock, tracksStock,
} from './stock-logic';

const insumo = (inventory_count: number, low_stock_threshold = 5): StockItem => ({ inventory_count, low_stock_threshold, tracks_stock: true });
const platillo = (inventory_count = 0, categoria = 'plato_fuerte'): StockItem => ({
  inventory_count, low_stock_threshold: 5, tracks_stock: false, metadata: { categoria },
});

describe('existencias de platillos e insumos', () => {
  it('un platillo no lleva existencias y un insumo sí', () => {
    expect(tracksStock(platillo())).toBe(false);
    expect(tracksStock(insumo(3))).toBe(true);
  });

  it('un producto sin la marca cuenta como si llevara existencias (servidor anterior)', () => {
    expect(tracksStock({})).toBe(true);
  });

  it('los platillos no entran en las alertas aunque tengan pocas o cero unidades', () => {
    const todos = [platillo(0), platillo(2), insumo(1), insumo(0), insumo(20)];
    expect(lowStock(todos)).toHaveLength(1);        // solo el insumo con 1
    expect(outOfStock(todos)).toHaveLength(1);      // solo el insumo con 0
  });

  it('el total de existencias no suma los platillos', () => {
    expect(totalStock([platillo(50), insumo(10), insumo(5)])).toBe(15);
  });

  it('stockTracked deja solo lo que lleva existencias', () => {
    expect(stockTracked([platillo(), insumo(1), insumo(2)])).toHaveLength(2);
  });

  it('el nivel de un insumo: agotado, bajo o bien', () => {
    expect(stockLevel(insumo(0))).toBe('out');
    expect(stockLevel(insumo(4))).toBe('low');
    expect(stockLevel(insumo(5))).toBe('ok');
  });
});

describe('cómo se ve cada producto', () => {
  it('un insumo dice sus unidades', () => {
    expect(stockDetail(insumo(7))).toBe('7 unidades en stock');
  });

  it('un platillo dice su categoría y no unidades', () => {
    expect(stockDetail(platillo(0, 'postre'))).toBe('Postre');
    expect(stockDetail(platillo(0, 'plato_fuerte'))).toBe('Plato fuerte');
    expect(stockDetail(platillo())).not.toMatch(/unidades/);
  });

  it('un platillo sin categoría conocida dice "Platillo"', () => {
    expect(stockDetail({ inventory_count: 0, low_stock_threshold: 1, tracks_stock: false })).toBe('Platillo');
  });

  it('el color de un platillo es neutro aunque tenga cero', () => {
    expect(stockColor(platillo(0))).toBe('#818cf8');
    expect(stockColor(insumo(0))).toBe('#f87171');
    expect(stockColor(insumo(2))).toBe('#fbbf24');
    expect(stockColor(insumo(50))).toBe('#34d399');
  });
});
