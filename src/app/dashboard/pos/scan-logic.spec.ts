/**
 * Prueba del cliente PC-07 — lógica del escáner de cámara (scan-logic)
 *
 * La cámara lee el mismo código decenas de veces por segundo. Si el punto de
 * venta contara cada lectura, un solo producto frente al lente se cobraría
 * muchas veces. Estas pruebas fijan cuándo una lectura cuenta y cuándo no.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_CODE_LENGTH,
  SAME_CODE_RELEASE_MS,
  ScanDebouncer,
  cleanScan,
  nativeIsEnough,
} from './scan-logic';

describe('PC-07 · scan-logic', () => {
  describe('cleanScan', () => {
    it('quita espacios y saltos de línea que añaden algunos lectores', () => {
      expect(cleanScan('  7501234567890\n')).toBe('7501234567890');
    });

    it('descarta lo vacío', () => {
      expect(cleanScan('')).toBeNull();
      expect(cleanScan('   ')).toBeNull();
      expect(cleanScan(null)).toBeNull();
      expect(cleanScan(undefined)).toBeNull();
    });

    it('descarta lo que el servidor rechazaría por largo', () => {
      expect(cleanScan('A'.repeat(MAX_CODE_LENGTH))).not.toBeNull();
      expect(cleanScan('A'.repeat(MAX_CODE_LENGTH + 1))).toBeNull();
    });
  });

  describe('ScanDebouncer', () => {
    it('la primera lectura cuenta', () => {
      expect(new ScanDebouncer().accept('TAC-01', 0)).toBe(true);
    });

    it('la misma lectura de inmediato no cuenta otra vez', () => {
      const d = new ScanDebouncer();
      d.accept('TAC-01', 0);
      expect(d.accept('TAC-01', 100)).toBe(false);
    });

    it('un código distinto cuenta de inmediato', () => {
      const d = new ScanDebouncer();
      d.accept('TAC-01', 0);
      expect(d.accept('REF-02', 10)).toBe(true);
    });

    it('seguir apuntando al mismo producto NO lo cuenta de nuevo, por mucho que tarde', () => {
      // El caso que importa: el cajero deja el producto frente a la cámara
      // diez segundos. Sin esta regla se le cobrarían seis o siete.
      const d = new ScanDebouncer();
      expect(d.accept('TAC-01', 0)).toBe(true);
      let cuentas = 0;
      for (let t = 140; t <= 10_000; t += 140) if (d.accept('TAC-01', t)) cuentas++;
      expect(cuentas).toBe(0);
    });

    it('apartarlo y volver a apuntarlo cuenta como otro (el segundo taco)', () => {
      const d = new ScanDebouncer();
      d.accept('TAC-01', 0);
      // Sale del cuadro: pasan más de SAME_CODE_RELEASE_MS sin verse.
      expect(d.accept('TAC-01', SAME_CODE_RELEASE_MS)).toBe(true);
    });

    it('un parpadeo corto de la cámara no se confunde con volver a apuntar', () => {
      const d = new ScanDebouncer();
      d.accept('TAC-01', 0);
      d.accept('TAC-01', 140);
      // Un par de cuadros sin lectura: menos que el tiempo de liberación.
      expect(d.accept('TAC-01', 140 + SAME_CODE_RELEASE_MS - 1)).toBe(false);
    });

    it('al alternar entre dos productos, cada uno cuenta una vez por pasada', () => {
      const d = new ScanDebouncer();
      expect(d.accept('A', 0)).toBe(true);
      expect(d.accept('B', 300)).toBe(true);
      // Vuelve a A: no se vio en más de 1.2 s, así que es una nueva pasada.
      expect(d.accept('A', 1400)).toBe(true);
    });

    it('con muchos códigos distintos no crece sin límite', () => {
      const d = new ScanDebouncer(1000);
      for (let i = 0; i < 500; i++) d.accept(`C-${i}`, i * 2000);
      // Todo lo anterior ya venció: lo viejo se olvidó y sigue funcionando.
      expect(d.accept('C-0', 2_000_000)).toBe(true);
    });
  });

  describe('nativeIsEnough', () => {
    it('acepta el lector nativo si entiende QR, Code 128 y EAN-13', () => {
      expect(nativeIsEnough(['qr_code', 'code_128', 'ean_13', 'upc_a'])).toBe(true);
    });

    it('lo rechaza si le falta alguno: se usa el de respaldo', () => {
      expect(nativeIsEnough(['qr_code'])).toBe(false);
      expect(nativeIsEnough(['code_128', 'ean_13'])).toBe(false);
      expect(nativeIsEnough([])).toBe(false);
    });
  });
});
