/**
 * Prueba del cliente PC-11 — Acceso por QR y equipos autorizados (device-logic)
 *
 * El QR lo puede fotografiar cualquiera, y el escáner del celular lee de todo
 * (productos, códigos de terceros). Estas pruebas fijan qué se acepta como QR
 * de acceso y cuándo vence un equipo.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  activeDeviceToken,
  approvalUrl,
  clearDevice,
  clock,
  isExpired,
  parseChallengeId,
  randomSecret,
  readDevice,
  saveDevice,
  secondsLeft,
  sha256Hex,
} from './device-logic';

const ID = 'AbCdEfGhIjKlMnOpQrStUv';       // 22 caracteres, como los del servidor
const AHORA = Date.parse('2026-11-02T12:00:00Z');
const en = (ms: number) => new Date(AHORA + ms).toISOString();

describe('PC-11 · device-logic', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  describe('vencimiento', () => {
    it('vence cuando llega la hora', () => {
      expect(isExpired(en(1000), AHORA)).toBe(false);
      expect(isExpired(en(0), AHORA)).toBe(true);
      expect(isExpired(en(-1000), AHORA)).toBe(true);
    });

    it('una fecha ausente o rota cuenta como vencida', () => {
      expect(isExpired(null)).toBe(true);
      expect(isExpired(undefined)).toBe(true);
      expect(isExpired('mañana')).toBe(true);
    });

    it('los segundos que faltan nunca son negativos', () => {
      expect(secondsLeft(en(90_000), AHORA)).toBe(90);
      expect(secondsLeft(en(-5_000), AHORA)).toBe(0);
      expect(secondsLeft('basura', AHORA)).toBe(0);
    });

    it('la cuenta regresiva se muestra como minutos:segundos', () => {
      expect(clock(125)).toBe('2:05');
      expect(clock(9)).toBe('0:09');
      expect(clock(-3)).toBe('0:00');
    });
  });

  describe('lo que lee el escáner', () => {
    it('acepta la dirección completa del QR', () => {
      expect(parseChallengeId(`https://kard.example.com/dashboard/aprobar#${ID}`)).toBe(ID);
    });

    it('acepta el identificador a secas', () => {
      expect(parseChallengeId(ID)).toBe(ID);
      expect(parseChallengeId(`  ${ID}\n`)).toBe(ID);
    });

    it('rechaza lo que no se parece a un identificador', () => {
      expect(parseChallengeId('')).toBeNull();
      expect(parseChallengeId(null)).toBeNull();
      expect(parseChallengeId('7501234567890')).toBeNull();      // un código de barras de producto
      expect(parseChallengeId('TAC-01')).toBeNull();             // un SKU
      expect(parseChallengeId('corto')).toBeNull();
      expect(parseChallengeId('a'.repeat(80))).toBeNull();
    });

    it('rechaza una dirección que NO es la de aprobación de KARD', () => {
      expect(parseChallengeId(`https://sitio-ajeno.example/login#${ID}`)).toBeNull();
      expect(parseChallengeId(`https://kard.example.com/otra-cosa#${ID}`)).toBeNull();
    });

    it('rechaza intentos de colar caracteres raros', () => {
      expect(parseChallengeId('https://x/dashboard/aprobar#../../etc/passwd')).toBeNull();
      expect(parseChallengeId(`https://x/dashboard/aprobar#${ID}<script>`)).toBeNull();
    });

    it('la dirección que se genera es la misma que se acepta al leerla', () => {
      expect(parseChallengeId(approvalUrl('https://kard.example.com/', ID))).toBe(ID);
    });

    it('el identificador va en el fragmento, que no viaja al servidor', () => {
      const url = approvalUrl('https://kard.example.com', ID);
      expect(url.split('#')[1]).toBe(ID);
      expect(new URL(url).search).toBe('');
    });
  });

  describe('token del equipo', () => {
    it('sin equipo guardado no hay token', () => {
      expect(readDevice()).toBeNull();
      expect(activeDeviceToken()).toBeNull();
    });

    it('un equipo vigente entrega su token', () => {
      saveDevice({ token: 'tok', name: 'Caja 1', expires_at: en(3_600_000) });
      expect(activeDeviceToken(AHORA)).toBe('tok');
    });

    it('un equipo vencido ya no entrega su token', () => {
      saveDevice({ token: 'tok', name: 'Caja 1', expires_at: en(-1) });
      expect(activeDeviceToken(AHORA)).toBeNull();
    });

    it('un registro dañado se ignora en vez de romper la pantalla', () => {
      localStorage.setItem('kard_device', '{no es json');
      expect(readDevice()).toBeNull();
      localStorage.setItem('kard_device', JSON.stringify({ token: 1 }));
      expect(readDevice()).toBeNull();
    });

    it('olvidar el equipo borra el token', () => {
      saveDevice({ token: 'tok', name: 'Caja 1', expires_at: en(3_600_000) });
      clearDevice();
      expect(readDevice()).toBeNull();
    });
  });

  describe('secreto de la computadora', () => {
    it('son 32 bytes en hexadecimal (64 caracteres) y no se repiten', () => {
      const a = randomSecret();
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(new Set(Array.from({ length: 100 }, () => randomSecret())).size).toBe(100);
    });

    it('el hash es SHA-256 en hexadecimal (el vector conocido de "abc")', async () => {
      expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    });

    it('al servidor se le manda un hash que no revela el secreto', async () => {
      const secreto = randomSecret();
      const hash = await sha256Hex(secreto);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      expect(hash).not.toBe(secreto);
    });
  });
});
