/**
 * Prueba del cliente PC-15 — Lógica del ticket compartido (ticket-sync-logic)
 *
 * Lo que se escanea en el celular tiene que aparecer en la computadora de la misma caja, sin que
 * un cambio viejo pise a uno nuevo. Estas pruebas fijan la forma de las operaciones, cómo se
 * traducen las líneas del servidor al ticket en pantalla y el orden en que valen las respuestas.
 */

import { describe, expect, it } from 'vitest';

import {
  MAX_QUANTITY,
  POLL_MS,
  ResponseOrder,
  linesToCart,
  localTicketUid,
  newOpId,
  ops,
  pollParams,
  sameLines,
} from './ticket-sync-logic';

/** La misma forma que acepta el servidor para una llave (Idempotency-Key y op_id). */
const LLAVE_VALIDA = /^[A-Za-z0-9_-]{16,80}$/;

const p = (id: string) => ({ product_id: id, name: `Producto ${id}`, price: '10.00' });

describe('PC-15 · ticket-sync-logic', () => {
  describe('llaves', () => {
    it('la llave de una operación tiene la forma que acepta el servidor', () => {
      expect(newOpId()).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
    });

    it('dos operaciones nunca comparten llave', () => {
      expect(new Set(Array.from({ length: 500 }, newOpId)).size).toBe(500);
    });

    it('la llave de un ticket que no se comparte sirve como Idempotency-Key', () => {
      expect(localTicketUid()).toMatch(LLAVE_VALIDA);
    });

    it('dos tickets locales nunca comparten llave', () => {
      expect(new Set(Array.from({ length: 500 }, localTicketUid)).size).toBe(500);
    });
  });

  describe('operaciones', () => {
    it('agregar lleva el producto y, por defecto, una unidad', () => {
      const o = ops.add('p_1');
      expect(o).toMatchObject({ type: 'add', product_id: 'p_1', quantity: 1 });
    });

    it('agregar con cantidad', () => {
      expect(ops.add('p_1', 3).quantity).toBe(3);
    });

    it('cambiar la cantidad nunca sale de 1 a 999', () => {
      expect(ops.setQuantity('p_1', 0).quantity).toBe(1);
      expect(ops.setQuantity('p_1', -4).quantity).toBe(1);
      expect(ops.setQuantity('p_1', 5000).quantity).toBe(MAX_QUANTITY);
      expect(ops.setQuantity('p_1', 7).quantity).toBe(7);
    });

    it('quitar lleva solo el producto', () => {
      const o = ops.remove('p_1');
      expect(o).toMatchObject({ type: 'remove', product_id: 'p_1' });
      expect(o.quantity).toBeUndefined();
    });

    it('vaciar sin identificador vacía lo que haya; con identificador, solo ese ticket', () => {
      expect(ops.clear().uid).toBeUndefined();
      expect(ops.clear('tk_abc').uid).toBe('tk_abc');
    });

    it('cada operación sale con su propia llave', () => {
      expect(ops.add('p_1').op_id).not.toBe(ops.add('p_1').op_id);
    });
  });

  describe('del servidor a la pantalla', () => {
    const catalogo = [p('p_1'), p('p_2'), p('p_3')];

    it('cada línea trae su producto completo', () => {
      const cart = linesToCart([{ product_id: 'p_2', quantity: 3 }], catalogo);
      expect(cart).toEqual([{ product: catalogo[1], quantity: 3 }]);
    });

    it('conserva el orden del servidor', () => {
      const cart = linesToCart(
        [{ product_id: 'p_3', quantity: 1 }, { product_id: 'p_1', quantity: 2 }],
        catalogo,
      );
      expect(cart.map(l => l.product.product_id)).toEqual(['p_3', 'p_1']);
    });

    it('un producto que ya no está en el catálogo se omite', () => {
      const cart = linesToCart([{ product_id: 'p_9', quantity: 1 }, { product_id: 'p_1', quantity: 1 }], catalogo);
      expect(cart.map(l => l.product.product_id)).toEqual(['p_1']);
    });

    it('un ticket vacío es un carrito vacío', () => {
      expect(linesToCart([], catalogo)).toEqual([]);
    });

    it('sin catálogo cargado todavía, no hay nada que mostrar (y nada se rompe)', () => {
      expect(linesToCart([{ product_id: 'p_1', quantity: 1 }], [])).toEqual([]);
    });
  });

  describe('comparar tickets', () => {
    it('iguales aunque lleguen en otro orden', () => {
      expect(sameLines(
        [{ product_id: 'a', quantity: 1 }, { product_id: 'b', quantity: 2 }],
        [{ product_id: 'b', quantity: 2 }, { product_id: 'a', quantity: 1 }],
      )).toBe(true);
    });

    it('distintos si cambia una cantidad', () => {
      expect(sameLines([{ product_id: 'a', quantity: 1 }], [{ product_id: 'a', quantity: 2 }])).toBe(false);
    });

    it('distintos si cambia el número de líneas', () => {
      expect(sameLines([{ product_id: 'a', quantity: 1 }], [])).toBe(false);
    });
  });

  describe('la consulta periódica', () => {
    it('la primera vez no hay nada que comparar', () => {
      expect(pollParams(null)).toBeNull();
    });

    it('después manda la revisión y el ticket que ya tiene, para que el servidor conteste 204', () => {
      expect(pollParams({ uid: 'tk_1', rev: 7, lines: [] })).toEqual({ since: 7, uid: 'tk_1' });
    });

    it('pregunta cada segundo y poco', () => {
      expect(POLL_MS).toBeGreaterThanOrEqual(500);
      expect(POLL_MS).toBeLessThanOrEqual(2000);
    });
  });

  describe('orden de las respuestas', () => {
    it('una respuesta vale si salió después de la última aplicada', () => {
      const o = new ResponseOrder();
      const a = o.next();
      expect(o.accepts(a)).toBe(true);
    });

    it('una consulta lenta que salió ANTES de un cambio propio no regresa el ticket al pasado', () => {
      const o = new ResponseOrder();
      const consulta = o.next();
      const cambio = o.next();
      o.markApplied(cambio);            // llegó primero la respuesta del cambio
      expect(o.accepts(consulta)).toBe(false);
    });

    it('lo que salió después de lo aplicado sí vale', () => {
      const o = new ResponseOrder();
      const a = o.next();
      o.markApplied(a);
      expect(o.accepts(o.next())).toBe(true);
    });

    it('marcar una respuesta vieja no hace retroceder lo aplicado', () => {
      const o = new ResponseOrder();
      const a = o.next();
      const b = o.next();
      o.markApplied(b);
      o.markApplied(a);
      expect(o.accepts(b)).toBe(false);
      expect(o.accepts(o.next())).toBe(true);
    });
  });
});
