/**
 * Prueba del cliente PC-10 — Contraseña inicial y datos del equipo (team-logic)
 *
 * La contraseña inicial de cada persona la genera la pantalla y la lee o la
 * dicta el gerente. Tiene que cumplir lo que exige el servidor (letra y número)
 * y no llevar caracteres que se confundan al leerlos.
 */

import { describe, expect, it } from 'vitest';

import { generatePassword, initialsOf, passwordProblem } from './team-logic';

describe('PC-10 · team-logic', () => {
  describe('generatePassword', () => {
    it('siempre cumple lo que exige el servidor', () => {
      for (let i = 0; i < 500; i++) {
        const pw = generatePassword();
        expect(passwordProblem(pw), pw).toBeNull();
      }
    });

    it('tiene 12 caracteres por defecto y respeta la longitud pedida', () => {
      expect(generatePassword()).toHaveLength(12);
      expect(generatePassword(16)).toHaveLength(16);
    });

    it('no usa caracteres que se confunden al leerlos (0, O, 1, l, I)', () => {
      for (let i = 0; i < 500; i++) expect(generatePassword()).not.toMatch(/[0O1lI]/);
    });

    it('no repite: dos contraseñas seguidas son distintas', () => {
      const vistas = new Set(Array.from({ length: 200 }, () => generatePassword()));
      expect(vistas.size).toBe(200);
    });
  });

  describe('passwordProblem', () => {
    it('acepta una contraseña con letras y números', () => {
      expect(passwordProblem('Segura123')).toBeNull();
    });

    it('rechaza lo corto, lo que no lleva número y lo que no lleva letra', () => {
      expect(passwordProblem('abc123')).toMatch(/8 caracteres/);
      expect(passwordProblem('sololetras')).toMatch(/número/);
      expect(passwordProblem('12345678')).toMatch(/letra/);
    });
  });

  describe('initialsOf', () => {
    it('dos iniciales de las dos primeras palabras', () => {
      expect(initialsOf('Eva López Ruiz')).toBe('EL');
    });

    it('con una sola palabra, sus dos primeras letras', () => {
      expect(initialsOf('Eva')).toBe('EV');
    });

    it('sin nombre, la inicial del correo', () => {
      expect(initialsOf(null, 'ana@example.com')).toBe('A');
      expect(initialsOf('   ', 'ana@example.com')).toBe('A');
    });

    it('sin nada, un signo de pregunta', () => {
      expect(initialsOf(null)).toBe('?');
    });

    it('ignora espacios de más', () => {
      expect(initialsOf('  eva   lópez ')).toBe('EL');
    });
  });
});
