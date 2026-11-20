/**
 * Avisos del plan: cada error 402/409 del contrato lleva al texto de la guía
 * (§17 de docs/Planes_contrato_frontend.md). El dueño ve qué hacer; el equipo, que le avise al dueño.
 */
import { describe, expect, it } from 'vitest';
import { asPlanError, lockedNotice, noticeFor } from './plan-notice.logic';

const err402 = (body: object) => asPlanError(402, { success: false, error: 'Mensaje del servidor', ...body })!;
const err409 = (body: object) => asPlanError(409, { success: false, error: 'Mensaje del servidor', ...body })!;

describe('asPlanError', () => {
  it('reconoce los 402 del plan y los 409 de cobro', () => {
    expect(asPlanError(402, { code: 'read_only' })).not.toBeNull();
    expect(asPlanError(409, { code: 'channel_cooldown', available_at: '2026-12-12T00:00:00Z' })).not.toBeNull();
  });

  it('no se mete con otros errores: el 409 de stock del carrito, un 402 sin code, un 500', () => {
    expect(asPlanError(409, { code: 'INSUFFICIENT_STOCK' })).toBeNull();
    expect(asPlanError(402, { error: 'x' })).toBeNull();
    expect(asPlanError(402, null)).toBeNull();
    expect(asPlanError(500, { code: 'read_only' })).toBeNull();
  });
});

describe('noticeFor (dueño)', () => {
  it('solo lectura: elegir plan', () => {
    const n = noticeFor(err402({ code: 'read_only' }), true)!;
    expect(n.title).toBe('Tu cuenta está en solo lectura');
    expect(n.message).toBe('Mensaje del servidor');
    expect(n.primary).toEqual({ label: 'Elegir plan', action: 'plans' });
  });

  it.each([
    ['pos', 'El punto de venta es parte de Pro'],
    ['delivery', 'Los envíos son parte de Pro'],
    ['algo_nuevo', 'Esta función es parte de Pro'],
  ])('función de Pro (%s)', (feature, title) => {
    const n = noticeFor(err402({ code: 'feature_locked', feature }), true)!;
    expect(n.title).toBe(title);
    expect(n.primary).toEqual({ label: 'Ver Pro', action: 'upgrade' });
  });

  it('límite de productos: pasar a Pro o administrar productos', () => {
    const n = noticeFor(err402({ code: 'limit_reached', limit: 'products', max: 50 }), true)!;
    expect(n.title).toBe('Llegaste a 50 productos');
    expect(n.primary).toEqual({ label: 'Pasar a Pro', action: 'upgrade' });
    expect(n.secondary).toEqual({ label: 'Administrar productos', action: 'products' });
  });

  it('límite de equipo: administrar equipo', () => {
    const n = noticeFor(err402({ code: 'limit_reached', limit: 'users', max: 2 }), true)!;
    expect(n.title).toBe('Tu equipo llegó a 2 personas');
    expect(n.secondary).toEqual({ label: 'Administrar equipo', action: 'team' });
  });

  it('cambio de mitad antes de tiempo: dice desde qué día', () => {
    const n = noticeFor(err409({ code: 'channel_cooldown', available_at: '2026-12-12T18:00:00Z' }), true)!;
    expect(n.title).toBe('Podrás cambiar el 12 de diciembre');
    expect(n.primary.action).toBe('close');
  });

  it('los 409 que solo indican una llamada equivocada no abren modal', () => {
    for (const code of ['subscription_exists', 'no_subscription', 'channel_required', 'same_plan', 'use_channel_change', 'not_starter', 'same_channel']) {
      expect(noticeFor(err409({ code }), true)).toBeNull();
    }
  });
});

describe('noticeFor (equipo)', () => {
  it('cualquier 402 es un solo mensaje, sin precios ni botón de pago', () => {
    for (const body of [{ code: 'feature_locked', feature: 'pos' }, { code: 'limit_reached', limit: 'products', max: 50 }]) {
      const n = noticeFor(err402(body), false)!;
      expect(n.title).toBe('Esta función no está disponible en el plan del negocio');
      expect(n.message).toBe('Avísale al dueño.');
      expect(n.primary.action).toBe('close');
      expect(n.secondary).toBeUndefined();
    }
  });

  it('en solo lectura se lo dice tal cual', () => {
    expect(noticeFor(err402({ code: 'read_only' }), false)!.title).toBe('La cuenta del negocio está en solo lectura');
  });
});

describe('lockedNotice', () => {
  it('el candado del menú le ofrece Pro al dueño', () => {
    expect(lockedNotice('store', true)).toMatchObject({ title: 'La tienda en línea es parte de Pro', primary: { action: 'upgrade' } });
  });

  it('y al equipo solo le pide avisar', () => {
    expect(lockedNotice('pos', false)).toMatchObject({ message: 'Avísale al dueño.', primary: { action: 'close' } });
  });
});
