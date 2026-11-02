/**
 * Prueba del cliente PC-12 — Pantalla de la caja registradora
 *
 * Lo que más importa de esta pantalla: la contraseña NUNCA viaja en la
 * dirección. Un formulario sin controlar se envía solo por GET y deja
 * `?password=…` en el historial y en los registros del servidor. Esta prueba
 * existe porque ya pasó una vez.
 */

import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router, provideRouter } from '@angular/router';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

import { RegisterModeComponent } from './register-mode.component';
import { environment } from '../../environments/environment';

const API = `${environment.apiUrl}/device-auth`;
const IN_AN_HOUR = () => new Date(Date.now() + 3_600_000).toISOString();

async function settle(): Promise<void> {
  // Deja correr las promesas del cálculo del hash y del QR.
  for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
}

describe('PC-12 · RegisterModeComponent', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kard_device', JSON.stringify({ token: 'tok', name: 'Caja 1', expires_at: IN_AN_HOUR() }));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpTestingController);
    vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  async function pantallaDeBloqueo() {
    const fixture = TestBed.createComponent(RegisterModeComponent);
    fixture.detectChanges();
    http.expectOne(`${API}/current`).flush({ device_id: 'dv_1', name: 'Caja 1' });
    await settle();
    // Pide su QR de desbloqueo; no importa qué conteste.
    http.match(`${API}/unlock-challenges`).forEach(r => r.flush({ challenge_id: 'x'.repeat(22), verification_code: '1234', expires_at: IN_AN_HOUR(), expires_in: 150 }));
    fixture.detectChanges();
    return fixture;
  }

  it('un equipo autorizado muestra la pantalla de bloqueo con el formulario', async () => {
    const fixture = await pantallaDeBloqueo();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('¿Quién va a cobrar?');
    expect(el.querySelector('#r-id')).not.toBeNull();
    fixture.destroy();
  });

  it('enviar el formulario NO lo deja pasar al navegador (la contraseña no va en la dirección)', async () => {
    const fixture = await pantallaDeBloqueo();
    const form = (fixture.nativeElement as HTMLElement).querySelector('form')!;

    const evento = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(evento);

    expect(evento.defaultPrevented).toBe(true);
    fixture.destroy();
  });

  it('el formulario no se envía por GET (no puede poner la contraseña en la dirección)', async () => {
    const fixture = await pantallaDeBloqueo();
    const form = (fixture.nativeElement as HTMLFormElement).querySelector('form')!;
    expect(form.method.toLowerCase()).toBe('post');
    fixture.destroy();
  });

  it('al enviar, pide entrar con el correo o código y la contraseña, y la contraseña va en el cuerpo', async () => {
    const fixture = await pantallaDeBloqueo();
    const el: HTMLElement = fixture.nativeElement;

    const poner = (selector: string, valor: string) => {
      const input = el.querySelector<HTMLInputElement>(selector)!;
      input.value = valor;
      input.dispatchEvent(new Event('input'));
    };
    poner('#r-id', '0002');
    poner('#r-pass', 'Prueba12345');
    fixture.detectChanges();

    el.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    const req = http.expectOne(`${API}/login`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ identifier: '0002', password: 'Prueba12345' });
    expect(req.request.url).not.toContain('Prueba12345');
    expect(req.request.urlWithParams).not.toContain('password');
    fixture.destroy();
  });

  it('sin datos no llama al servidor', async () => {
    const fixture = await pantallaDeBloqueo();
    (fixture.nativeElement as HTMLElement).querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    http.expectNone(`${API}/login`);
    fixture.destroy();
  });

  it('un equipo sin autorizar muestra el QR para que la gerencia lo autorice', async () => {
    localStorage.clear();
    const fixture = TestBed.createComponent(RegisterModeComponent);
    fixture.detectChanges();
    await settle();
    http.match(`${API}/enroll-challenges`).forEach(r => r.flush({ challenge_id: 'y'.repeat(22), verification_code: '4821', expires_at: IN_AN_HOUR(), expires_in: 150 }));
    await settle();
    fixture.detectChanges();

    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('Autoriza este equipo');
    expect(el.textContent).toContain('4821');
    fixture.destroy();
  });
});
