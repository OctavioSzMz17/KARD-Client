/**
 * Prueba del cliente PC-08 — etiquetas de producto (labels)
 *
 * Lo impreso tiene que poder leerse de vuelta: el código que lleva la
 * etiqueta es el mismo que el servidor busca al escanear. Si el orden
 * (código de barras, SKU, id) no coincidiera con el de `GET /products/lookup`,
 * una etiqueta recién impresa no encontraría su producto.
 */

import { describe, expect, it } from 'vitest';

import { barcodeSvg, labelCode, qrSvg, usesFallbackId } from './labels';

const producto = (extra: Partial<{ sku: string | null; barcode: string | null }> = {}) => ({
  product_id: 'p_abc123',
  sku: null,
  barcode: null,
  ...extra,
});

describe('PC-08 · labels', () => {
  describe('labelCode', () => {
    it('prefiere el código de barras', () => {
      expect(labelCode(producto({ sku: 'TAC-01', barcode: '7501234567890' }))).toBe('7501234567890');
    });

    it('sin código de barras usa el SKU', () => {
      expect(labelCode(producto({ sku: 'TAC-01' }))).toBe('TAC-01');
    });

    it('sin ninguno de los dos usa el id del producto', () => {
      expect(labelCode(producto())).toBe('p_abc123');
    });

    it('un SKU o código vacío cuenta como ausente', () => {
      expect(labelCode(producto({ sku: '', barcode: '' }))).toBe('p_abc123');
    });
  });

  describe('usesFallbackId', () => {
    it('avisa solo cuando no hay SKU ni código de barras', () => {
      expect(usesFallbackId(producto())).toBe(true);
      expect(usesFallbackId(producto({ sku: 'TAC-01' }))).toBe(false);
      expect(usesFallbackId(producto({ barcode: '750123' }))).toBe(false);
    });
  });

  describe('qrSvg', () => {
    it('genera un SVG', async () => {
      const svg = await qrSvg('TAC-01');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toContain('viewBox');
    });

    it('el mismo valor da el mismo dibujo y valores distintos, dibujos distintos', async () => {
      expect(await qrSvg('TAC-01')).toBe(await qrSvg('TAC-01'));
      expect(await qrSvg('TAC-01')).not.toBe(await qrSvg('TAC-02'));
    });

    it('no mete el valor como texto dentro del SVG', async () => {
      // El SVG se muestra como HTML: no debe arrastrar texto del usuario.
      expect(await qrSvg('TAC-01')).not.toContain('TAC-01');
    });
  });

  describe('barcodeSvg', () => {
    it('genera un SVG que escala con su contenedor', () => {
      const svg = barcodeSvg('7501234567890');
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/);
      // Sin medidas fijas en la raíz: el tamaño lo decide la etiqueta. (Las
      // barras interiores sí llevan su ancho; eso no afecta la escala.)
      const root = svg.slice(0, svg.indexOf('>') + 1);
      expect(root).not.toMatch(/\swidth="/);
      expect(root).not.toMatch(/\sheight="/);
      expect(root).not.toMatch(/width:|height:/);
    });

    it('acepta letras, guiones y barras, como un SKU', () => {
      expect(() => barcodeSvg('TAC-01/A')).not.toThrow();
      expect(() => barcodeSvg('p_85d46db5cb87')).not.toThrow();
    });

    it('valores distintos dan barras distintas', () => {
      expect(barcodeSvg('TAC-01')).not.toBe(barcodeSvg('TAC-02'));
    });
  });
});
