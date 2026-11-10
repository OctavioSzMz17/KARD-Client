import { describe, expect, it } from 'vitest';
import {
  BoardSale, addressLines, boardState, groupByState, isActive, isLate, modeLabel, needsPayment,
  newOrders, nextStep, shortFolio, waitLabel,
} from './orders-board-logic';

const NOW = Date.parse('2026-11-09T20:00:00Z');
const hace = (minutes: number) => new Date(NOW - minutes * 60000).toISOString();

function sale(over: Partial<BoardSale> = {}): BoardSale {
  return {
    order_id: 'ord_abc12345', status: 'pending', fulfillment_type: 'pickup', fulfillment_status: 'preparing',
    total: '100.00', item_count: 2, customer_name: 'Ana', items: [{ product_name: 'Chilaquiles', quantity: 2 }],
    created_at: hace(5), ...over,
  };
}

describe('en qué columna cae un pedido', () => {
  it('por su estado de entrega', () => {
    for (const estado of ['preparing', 'ready', 'in_transit', 'completed'] as const) {
      expect(boardState(sale({ fulfillment_status: estado }))).toBe(estado);
    }
  });

  it('lo cancelado gana, venga del pago o de la entrega', () => {
    expect(boardState(sale({ status: 'canceled' }))).toBe('canceled');
    expect(boardState(sale({ fulfillment_status: 'canceled' }))).toBe('canceled');
  });

  it('fulfilled (valor viejo del pago) cuenta como entregado', () => {
    expect(boardState(sale({ status: 'fulfilled', fulfillment_status: 'preparing' }))).toBe('completed');
  });

  it('un estado desconocido se trata como nuevo, no se pierde', () => {
    expect(boardState(sale({ fulfillment_status: 'algo_raro' }))).toBe('preparing');
  });
});

describe('las columnas', () => {
  it('reparte cada pedido en su columna', () => {
    const cols = groupByState([
      sale({ order_id: 'a' }), sale({ order_id: 'b', fulfillment_status: 'ready' }),
      sale({ order_id: 'c', fulfillment_status: 'completed' }), sale({ order_id: 'd', status: 'canceled' }),
    ]);
    expect(cols.preparing.map(s => s.order_id)).toEqual(['a']);
    expect(cols.ready.map(s => s.order_id)).toEqual(['b']);
    expect(cols.completed.map(s => s.order_id)).toEqual(['c']);
    expect(cols.canceled.map(s => s.order_id)).toEqual(['d']);
  });

  it('lo que falta por atender, el más antiguo primero', () => {
    const cols = groupByState([
      sale({ order_id: 'nuevo', created_at: hace(2) }), sale({ order_id: 'viejo', created_at: hace(30) }),
    ]);
    expect(cols.preparing.map(s => s.order_id)).toEqual(['viejo', 'nuevo']);
  });

  it('lo ya cerrado, lo último arriba', () => {
    const cols = groupByState([
      sale({ order_id: 'antes', fulfillment_status: 'completed', created_at: hace(300) }),
      sale({ order_id: 'despues', fulfillment_status: 'completed', created_at: hace(10) }),
    ]);
    expect(cols.completed.map(s => s.order_id)).toEqual(['despues', 'antes']);
  });
});

describe('el siguiente paso', () => {
  it('nuevo → lista', () => {
    expect(nextStep(sale())).toEqual({ label: 'Marcar lista', patch: { fulfillment_status: 'ready' } });
  });

  it('lista para recoger → entregada', () => {
    expect(nextStep(sale({ fulfillment_status: 'ready', fulfillment_type: 'pickup' }))?.patch)
      .toEqual({ fulfillment_status: 'completed' });
  });

  it('lista en mesa → servida', () => {
    const paso = nextStep(sale({ fulfillment_status: 'ready', fulfillment_type: 'dine_in' }));
    expect(paso?.label).toBe('Servida');
    expect(paso?.patch).toEqual({ fulfillment_status: 'completed' });
  });

  it('lista a domicilio → sale a la calle, y de ahí a entregada', () => {
    const lista = nextStep(sale({ fulfillment_status: 'ready', fulfillment_type: 'delivery' }));
    expect(lista?.patch).toEqual({ fulfillment_status: 'in_transit' });
    const enCamino = nextStep(sale({ fulfillment_status: 'in_transit', fulfillment_type: 'delivery' }));
    expect(enCamino?.patch).toEqual({ fulfillment_status: 'completed' });
  });

  it('lo entregado o cancelado ya no tiene paso', () => {
    expect(nextStep(sale({ fulfillment_status: 'completed' }))).toBeNull();
    expect(nextStep(sale({ status: 'canceled' }))).toBeNull();
  });
});

describe('cobro', () => {
  it('un pedido en marcha y sin cobrar pide pago', () => {
    expect(needsPayment(sale({ status: 'pending' }))).toBe(true);
    expect(needsPayment(sale({ status: 'paid' }))).toBe(false);
  });

  it('un pedido ya cerrado no pide pago', () => {
    expect(needsPayment(sale({ status: 'pending', fulfillment_status: 'completed' }))).toBe(false);
    expect(needsPayment(sale({ status: 'canceled' }))).toBe(false);
  });

  it('en marcha es lo que no está entregado ni cancelado', () => {
    expect(isActive(sale({ fulfillment_status: 'ready' }))).toBe(true);
    expect(isActive(sale({ fulfillment_status: 'completed' }))).toBe(false);
  });
});

describe('textos', () => {
  it('modo de entrega', () => {
    expect(modeLabel({ fulfillment_type: 'dine_in', table_number: '7' })).toBe('En mesa 7');
    expect(modeLabel({ fulfillment_type: 'dine_in', table_number: null })).toBe('En el local');
    expect(modeLabel({ fulfillment_type: 'takeaway' })).toBe('Para llevar');
    expect(modeLabel({ fulfillment_type: 'pickup' })).toBe('Pasa a recoger');
    expect(modeLabel({ fulfillment_type: 'delivery' })).toBe('A domicilio');
  });

  it('cuánto lleva esperando', () => {
    expect(waitLabel(hace(0), NOW)).toBe('ahora mismo');
    expect(waitLabel(hace(7), NOW)).toBe('hace 7 min');
    expect(waitLabel(hace(125), NOW)).toBe('hace 2 h');
    expect(waitLabel(hace(60 * 24), NOW)).toBe('hace 1 día');
    expect(waitLabel(hace(60 * 24 * 3), NOW)).toBe('hace 3 días');
  });

  it('una hora en el futuro (reloj desfasado) no da un número negativo', () => {
    expect(waitLabel(hace(-10), NOW)).toBe('ahora mismo');
  });

  it('el folio corto', () => {
    expect(shortFolio('ord_abc12345')).toBe('12345');
  });
});

describe('pedidos tardados', () => {
  it('un pedido nuevo con 20 minutos o más ya va tarde', () => {
    expect(isLate(sale({ created_at: hace(19) }), NOW)).toBe(false);
    expect(isLate(sale({ created_at: hace(20) }), NOW)).toBe(true);
  });

  it('solo aplica a los que siguen sin atenderse', () => {
    expect(isLate(sale({ created_at: hace(90), fulfillment_status: 'ready' }), NOW)).toBe(false);
  });
});

describe('dirección de entrega', () => {
  it('arma las líneas sin las partes vacías', () => {
    expect(addressLines({ street: 'Calle 5 #12', neighborhood: 'Centro', city: 'Monterrey', state: 'NL', postal_code: '64000' }))
      .toEqual(['Calle 5 #12', 'Centro, Monterrey, NL · C.P. 64000']);
    expect(addressLines({ street: 'Calle 5', city: 'Monterrey' })).toEqual(['Calle 5', 'Monterrey']);
  });

  it('sin dirección no hay líneas', () => {
    expect(addressLines(null)).toEqual([]);
    expect(addressLines(undefined)).toEqual([]);
  });
});

describe('avisar de pedidos nuevos', () => {
  it('la primera carga no avisa de lo que ya había', () => {
    expect(newOrders(null, [sale({ order_id: 'a' })])).toEqual([]);
  });

  it('avisa solo de los nuevos que no se habían visto', () => {
    const nuevos = newOrders(new Set(['a']), [sale({ order_id: 'a' }), sale({ order_id: 'b' })]);
    expect(nuevos.map(s => s.order_id)).toEqual(['b']);
  });

  it('un pedido que ya avanzó de columna no cuenta como nuevo', () => {
    expect(newOrders(new Set(), [sale({ order_id: 'x', fulfillment_status: 'ready' })])).toEqual([]);
  });
});
