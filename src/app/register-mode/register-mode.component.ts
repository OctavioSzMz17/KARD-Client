import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { ChallengeCreated, DeviceService } from '../core/services/device.service';
import { approvalUrl, clock, randomSecret, secondsLeft, sha256Hex } from '../core/device-logic';
import { qrSvg } from '../dashboard/products/labels';
import { BRAND_NAME } from '../shared/brand';

/** Cada cuánto se pregunta al servidor si ya aprobaron el QR. */
const POLL_MS = 1500;

type Phase = 'checking' | 'enroll' | 'lock';

/**
 * La pantalla de la caja registradora.
 *
 *   enroll  Este equipo aún no está autorizado: muestra un QR y un código. La
 *           gerencia lo lee con su celular, teclea el código y lo autoriza
 *           por el día.
 *   lock    El equipo ya está autorizado: pide identificarse. La persona entra con
 *           su correo o código de empleado y contraseña, o lee el QR con su
 *           celular (ya con sesión iniciada).
 *
 * El QR solo lleva un identificador. Lo que desbloquea o autoriza se entrega
 * únicamente a esta computadora, que guarda un secreto del que el servidor solo
 * conoce el hash: fotografiar el QR no sirve para nada.
 */
@Component({
  selector: 'app-register-mode',
  imports: [RouterLink],
  templateUrl: './register-mode.component.html',
  styleUrl: './register-mode.component.scss',
})
export class RegisterModeComponent implements OnInit, OnDestroy {
  /** Nombre del producto en pantalla (ver shared/brand.ts). */
  readonly brand = BRAND_NAME;
  private auth = inject(AuthService);
  private device = inject(DeviceService);
  private router = inject(Router);
  private sanitizer = inject(DomSanitizer);

  readonly phase = signal<Phase>('checking');
  readonly deviceName = computed(() => this.device.device()?.name ?? 'Caja');

  // ── El QR en pantalla ─────────────────────────────────
  readonly qr = signal<SafeHtml | null>(null);
  readonly code = signal('');
  readonly secondsLeft = signal(0);
  readonly countdown = computed(() => clock(this.secondsLeft()));
  readonly notice = signal<string | null>(null);

  // ── Entrar con datos ──────────────────────────────────
  readonly identifier = signal('');
  readonly password = signal('');
  readonly entering = signal(false);
  readonly loginError = signal<string | null>(null);
  readonly showPassword = signal(false);

  private challenge: ChallengeCreated | null = null;
  private secret = '';
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;
  /** Cada QR nuevo invalida los anteriores: lo que llegue de uno viejo se ignora. */
  private generation = 0;

  ngOnInit(): void {
    if (!this.device.isAuthorized()) {
      this.device.forget();
      this.begin('enroll');
      return;
    }
    // El navegador cree que está autorizado: se confirma con el servidor (pudieron retirarlo).
    this.device.verify().subscribe({
      next: () => this.begin('lock'),
      error: () => {
        this.device.forget();
        this.begin('enroll', 'Este equipo ya no está autorizado. Pide a la gerencia que lo autorice de nuevo.');
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.stopTimers();
  }

  private begin(phase: Phase, notice: string | null = null): void {
    this.phase.set(phase);
    this.notice.set(notice);
    void this.newChallenge();
  }

  // ── QR ────────────────────────────────────────────────
  private async newChallenge(): Promise<void> {
    this.stopTimers();
    const generation = ++this.generation;
    this.qr.set(null);
    this.secret = randomSecret();
    const hash = await sha256Hex(this.secret);
    if (this.destroyed || generation !== this.generation) return;

    const request =
      this.phase() === 'enroll' ? this.device.createEnrollChallenge(hash) : this.device.createUnlockChallenge(hash);

    request.subscribe({
      next: async created => {
        if (this.destroyed || generation !== this.generation) return;
        this.challenge = created;
        this.code.set(created.verification_code);
        this.secondsLeft.set(secondsLeft(created.expires_at));
        const svg = await qrSvg(approvalUrl(window.location.origin, created.challenge_id));
        if (this.destroyed || generation !== this.generation) return;
        this.qr.set(this.sanitizer.bypassSecurityTrustHtml(svg));
        this.startTimers(generation, created);
      },
      error: (err: HttpErrorResponse) => this.onChallengeError(err),
    });
  }

  private onChallengeError(err: HttpErrorResponse): void {
    // El servidor ya no reconoce este equipo: se vuelve a autorizar.
    if (err.error?.code === 'DEVICE_NOT_AUTHORIZED' || err.status === 403) {
      this.device.forget();
      this.begin('enroll', 'Este equipo ya no está autorizado. Pide a la gerencia que lo autorice de nuevo.');
      return;
    }
    this.notice.set(
      err.status === 429 ? 'Demasiados intentos seguidos. Espera unos minutos.' : 'No se pudo preparar el código. Reintentando…',
    );
    this.pollTimer = setTimeout(() => void this.newChallenge(), 5000);
  }

  private startTimers(generation: number, created: ChallengeCreated): void {
    this.tickTimer = setInterval(() => {
      const left = secondsLeft(created.expires_at);
      this.secondsLeft.set(left);
      if (left <= 0) void this.newChallenge();        // el QR caducó: uno nuevo, sin que nadie toque nada
    }, 1000);
    this.schedulePoll(generation, created);
  }

  private schedulePoll(generation: number, created: ChallengeCreated): void {
    this.pollTimer = setTimeout(() => this.poll(generation, created), POLL_MS);
  }

  private poll(generation: number, created: ChallengeCreated): void {
    if (this.destroyed || generation !== this.generation) return;

    this.device.claim(created.challenge_id, this.secret).subscribe({
      next: result => {
        if (this.destroyed || generation !== this.generation) return;

        if (result.status === 'pending') return this.schedulePoll(generation, created);

        if (result.status === 'denied') {
          this.notice.set('Se equivocó el código tres veces. Se generó uno nuevo.');
          return void this.newChallenge();
        }

        this.stopTimers();
        if (result.device_token) {
          // Equipo autorizado: pasa a pedir quién va a cobrar.
          this.device.acceptClaim(result);
          this.begin('lock');
        } else if (result.login) {
          this.auth.startBusinessSession(result.login);
          this.router.navigateByUrl(this.auth.homeRoute());
        }
      },
      error: (err: HttpErrorResponse) => {
        if (this.destroyed || generation !== this.generation) return;
        // Caducó o ya se usó: uno nuevo. Un fallo de red: se sigue preguntando.
        if (err.status === 410 || err.status === 404) return void this.newChallenge();
        this.schedulePoll(generation, created);
      },
    });
  }

  private stopTimers(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    if (this.tickTimer) clearInterval(this.tickTimer);
    this.pollTimer = this.tickTimer = null;
  }

  // ── Entrar con correo o código de empleado ────────────
  /**
   * Siempre se frena el envío nativo del formulario: con él, el navegador
   * mandaría el correo y la CONTRASEÑA en la dirección de la página, que queda
   * en el historial y en los registros.
   */
  onSubmit(event: Event): void {
    event.preventDefault();
    this.submit();
  }

  submit(): void {
    const id = this.identifier().trim();
    if (!id || !this.password()) {
      this.loginError.set('Escribe tu correo o código de empleado y tu contraseña.');
      return;
    }
    this.entering.set(true);
    this.loginError.set(null);

    this.device.loginOnDevice(id, this.password()).subscribe({
      next: res => {
        this.entering.set(false);
        this.password.set('');
        this.auth.startBusinessSession(res);
        this.router.navigateByUrl(this.auth.homeRoute());
      },
      error: (err: HttpErrorResponse) => {
        this.entering.set(false);
        this.password.set('');
        if (err.error?.code === 'DEVICE_NOT_AUTHORIZED') {
          this.device.forget();
          return this.begin('enroll', 'Este equipo ya no está autorizado. Pide a la gerencia que lo autorice de nuevo.');
        }
        this.loginError.set(
          err.status === 429
            ? 'Demasiados intentos. Espera unos minutos o usa el QR.'
            : 'Los datos no son correctos. Revisa tu correo o código y tu contraseña.',
        );
      },
    });
  }
}
