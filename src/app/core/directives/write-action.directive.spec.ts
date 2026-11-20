/**
 * Modo solo lectura (§13 de docs/Planes_contrato_frontend.md): las acciones que
 * modifican se deshabilitan con "Disponible al elegir un plan", y Cobrar y
 * Caja se cambian por una pantalla de candado.
 */
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEV_PLAN_PRESETS } from '../plan-logic';
import { AuthService } from '../services/auth.service';
import { ReadOnlyLockComponent } from '../../dashboard/read-only-lock/read-only-lock.component';
import { READ_ONLY_HINT, WriteActionDirective } from './write-action.directive';

@Component({
  imports: [WriteActionDirective],
  template: `
    <button id="guardar" appWrite (click)="saved = saved + 1">Guardar</button>
    <button id="ocupado" appWrite [appWriteDisabled]="busy()" title="Eliminar">Eliminar</button>
    <button id="filtrar" (click)="filtered = true">Filtrar</button>
  `,
})
class Pantalla {
  saved = 0;
  filtered = false;
  busy = signal(false);
}

function sesion(plan: string, owner = true): void {
  TestBed.inject(AuthService).profile.set({
    kind: 'b2b', user_id: 'u_1', tenant_id: 't_1', role: owner ? 'business_admin' : 'staff', business_type: 'restaurant',
    permissions: owner ? ['billing:manage', 'pos:sell'] : ['pos:sell'], plan: DEV_PLAN_PRESETS[plan](Date.now()),
  });
}

beforeEach(() => {
  localStorage.clear();
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('appWrite', () => {
  function abrir(plan: string) {
    sesion(plan);
    const f = TestBed.createComponent(Pantalla);
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    return { f, btn: (id: string) => el.querySelector(`#${id}`) as HTMLButtonElement };
  }

  it('con la cuenta al día no cambia nada', () => {
    const { f, btn } = abrir('pro');
    expect(btn('guardar').disabled).toBe(false);
    expect(btn('guardar').hasAttribute('title')).toBe(false);
    btn('guardar').click();
    expect(f.componentInstance.saved).toBe(1);
  });

  it('en solo lectura deshabilita la acción con el tooltip y no la ejecuta', () => {
    const { f, btn } = abrir('vencido');
    expect(btn('guardar').disabled).toBe(true);
    expect(btn('guardar').title).toBe(READ_ONLY_HINT);
    expect(btn('guardar').classList).toContain('write-locked');
    btn('guardar').click();
    expect(f.componentInstance.saved).toBe(0);
  });

  it('consultar sigue funcionando', () => {
    const { f, btn } = abrir('vencido');
    expect(btn('filtrar').disabled).toBe(false);
    btn('filtrar').click();
    expect(f.componentInstance.filtered).toBe(true);
  });

  it('respeta lo que ya deshabilitaba el control y su title propio', () => {
    const { f, btn } = abrir('pro');
    expect(btn('ocupado').title).toBe('Eliminar');
    f.componentInstance.busy.set(true);
    f.detectChanges();
    expect(btn('ocupado').disabled).toBe(true);
    expect(btn('ocupado').title).toBe('Eliminar');
  });

  it('si el plan cambia (pagó), se vuelve a habilitar sin recargar', () => {
    const { f, btn } = abrir('vencido');
    TestBed.inject(AuthService).setPlan(DEV_PLAN_PRESETS['pro'](Date.now()));
    f.detectChanges();
    expect(btn('guardar').disabled).toBe(false);
  });
});

describe('ReadOnlyLockComponent', () => {
  function abrir(owner: boolean) {
    sesion('vencido', owner);
    const f = TestBed.createComponent(ReadOnlyLockComponent);
    f.componentRef.setInput('action', 'cobrar');
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('el dueño ve por qué y el botón para elegir plan', () => {
    const el = abrir(true);
    expect(el.querySelector('h2')?.textContent).toBe('Tu cuenta está en solo lectura');
    expect(el.textContent).toContain('para cobrar necesitas un plan');
    expect(el.querySelector('a.lock-btn')?.getAttribute('href')).toBe('/dashboard/suscripcion');
  });

  it('el equipo, que le avise al dueño, sin botón', () => {
    const el = abrir(false);
    expect(el.textContent).toContain('Avísale al dueño');
    expect(el.querySelector('a.lock-btn')).toBeNull();
  });
});
