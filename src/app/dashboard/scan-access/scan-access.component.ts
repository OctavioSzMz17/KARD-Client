import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import { ChallengeInfo, DeviceService } from '../../core/services/device.service';
import { PERM } from '../../core/permissions';
import { parseChallengeId } from '../../core/device-logic';
import { centsToApi, toCents } from '../pos/pos-math';
import { ScanStatus } from '../pos/scan-logic';
import { ScannerComponent } from '../pos/scanner.component';

/**
 * Escanear: desde el celular, aprobar el QR de una caja registradora.
 *
 *   Autorizar un equipo   Solo la gerencia. Se teclea el número que muestra la
 *                         computadora (así no se aprueba a ciegas un QR que
 *                         alguien más puso enfrente) y, si se quiere, se abre la
 *                         caja con el fondo inicial en el mismo paso.
 *   Entrar en una caja    Cualquier persona del negocio, con su propia sesión: la
 *                         caja abre sesión a su nombre y los tickets quedan a su nombre.
 *
 * Se llega leyendo el QR con la cámara de esta pantalla o abriendo la dirección
 * que lleva el QR con la cámara normal del celular (`/dashboard/aprobar#…`).
 */
@Component({
  selector: 'app-scan-access',
  imports: [ScannerComponent],
  templateUrl: './scan-access.component.html',
  styleUrl: './scan-access.component.scss',
})
export class ScanAccessComponent implements OnInit {
  private svc = inject(DeviceService);
  private auth = inject(AuthService);

  readonly canAuthorize = computed(() => this.auth.can(PERM.devicesAuthorize));
  readonly canOpenCash = computed(() => this.auth.can(PERM.cashManage));
  readonly myName = computed(() => this.auth.displayName());
  readonly canScan = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && window.isSecureContext;

  readonly scannerOpen = signal(false);
  readonly scanStatus = signal<ScanStatus | null>(null);
  private scanCounter = 0;

  readonly challengeId = signal<string | null>(null);
  readonly info = signal<ChallengeInfo | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly done = signal<string | null>(null);

  // Formulario de autorización.
  readonly deviceName = signal('Caja 1');
  readonly code = signal('');
  readonly openCash = signal(false);
  readonly floatText = signal('');

  ngOnInit(): void {
    // La dirección del QR abierta con la cámara normal: el identificador viene en el fragmento.
    const id = parseChallengeId(window.location.href);
    if (id) this.load(id);
  }

  // ── Leer el QR ────────────────────────────────────────
  openScanner(): void {
    this.scanStatus.set(null);
    this.done.set(null);
    this.error.set(null);
    this.scannerOpen.set(true);
  }

  closeScanner(): void {
    this.scannerOpen.set(false);
  }

  onScanned(raw: string): void {
    const id = parseChallengeId(raw);
    if (!id) {
      // Un código de producto o de cualquier otra cosa: no se manda al servidor.
      this.scanStatus.set({ n: ++this.scanCounter, ok: false, text: 'Este código no es de una caja de KARD.' });
      return;
    }
    this.closeScanner();
    this.load(id);
  }

  private load(id: string): void {
    this.loading.set(true);
    this.error.set(null);
    this.done.set(null);
    this.info.set(null);

    this.svc.challengeInfo(id).subscribe({
      next: info => {
        this.loading.set(false);
        this.challengeId.set(id);
        this.info.set(info);
        this.code.set('');
        this.openCash.set(false);
        this.floatText.set('');
        if (window.location.hash) history.replaceState(null, '', window.location.pathname);   // el identificador ya no hace falta en la barra
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.explain(err, 'No se pudo leer el código.'));
      },
    });
  }

  // ── Aprobar ───────────────────────────────────────────
  approve(): void {
    const id = this.challengeId();
    const info = this.info();
    if (!id || !info) return;

    const body: { device_name?: string; code?: string; open_float?: string } = {};

    if (info.kind === 'enroll') {
      if (!/^\d{4}$/.test(this.code().trim())) return this.error.set('Escribe el número de 4 dígitos que se ve en la computadora.');
      body.code = this.code().trim();
      body.device_name = this.deviceName().trim() || 'Caja';

      if (this.openCash()) {
        const cents = toCents(this.floatText().trim() === '' ? '0' : this.floatText());
        if (cents === null) return this.error.set('Escribe un fondo inicial válido.');
        body.open_float = centsToApi(cents);
      }
    }

    this.busy.set(true);
    this.error.set(null);
    this.svc.approve(id, body).subscribe({
      next: result => {
        this.busy.set(false);
        this.info.set(null);
        this.challengeId.set(null);
        this.done.set(
          info.kind === 'enroll'
            ? `${body.device_name} quedó autorizada para hoy.` + (result.cash_opened ? ' La caja se abrió con el fondo inicial.' : '')
            : `Listo: la caja abrió sesión a tu nombre.`,
        );
      },
      error: (err: HttpErrorResponse) => {
        this.busy.set(false);
        const code = err.error?.code;
        // Un QR que ya no sirve se descarta; un código mal tecleado se puede reintentar.
        if (code === 'CHALLENGE_NOT_FOUND' || code === 'CHALLENGE_EXPIRED') {
          this.info.set(null);
          this.challengeId.set(null);
        }
        this.error.set(this.explain(err, 'No se pudo aprobar.'));
      },
    });
  }

  cancel(): void {
    this.info.set(null);
    this.challengeId.set(null);
    this.error.set(null);
  }

  private explain(err: HttpErrorResponse, fallback: string): string {
    const body = err.error;
    switch (body?.code) {
      case 'CHALLENGE_NOT_FOUND': return 'Este código ya no es válido. Pide que muestren uno nuevo en la computadora.';
      case 'CHALLENGE_EXPIRED':   return 'El código caducó. Se renueva solo en la computadora: léelo otra vez.';
      case 'WRONG_CODE':          return 'El número no coincide con el de la pantalla. Revísalo.';
      case 'FORBIDDEN':           return typeof body.error === 'string' ? body.error : 'No tienes permiso para esto.';
    }
    return typeof body?.error === 'string' ? body.error : fallback;
  }
}
