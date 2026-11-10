import { AfterViewInit, Component, ElementRef, OnDestroy, input, output, signal, viewChild } from '@angular/core';
import {
  SCAN_FORMATS,
  ScanDebouncer,
  ScanStatus,
  cleanScan,
  nativeIsEnough,
} from './scan-logic';

/** Lo único que se le pide a un lector, sea el nativo del navegador o el de respaldo. */
interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

/** Cada cuánto se intenta leer un cuadro. Más seguido gasta batería sin leer mejor. */
const TICK_MS = 140;

/**
 * Lector del navegador si lo hay y sirve (Chrome en Android); si no
 * (Safari en iPhone), el de respaldo — ZXing compilado a WebAssembly —, que se
 * descarga solo al abrir el escáner y se sirve desde este mismo sitio.
 */
async function createDetector(): Promise<Detector> {
  const Native = (window as unknown as { BarcodeDetector?: any }).BarcodeDetector;
  if (Native) {
    try {
      const supported: string[] = await Native.getSupportedFormats();
      if (nativeIsEnough(supported)) {
        return new Native({ formats: SCAN_FORMATS.filter(f => supported.includes(f)) });
      }
    } catch {
      /* el lector nativo falló: se cae al de respaldo */
    }
  }

  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill');
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? new URL(`wasm/${path}`, document.baseURI).href : prefix + path,
  });
  return new BarcodeDetector({ formats: [...SCAN_FORMATS] }) as unknown as Detector;
}

/** Por qué no abrió la cámara, dicho para quien cobra y no para quien programa. */
function explain(error: unknown): string {
  const name = (error as { name?: string })?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'No hay permiso para usar la cámara. Actívalo en los ajustes del navegador para este sitio y vuelve a intentar.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Este dispositivo no tiene una cámara disponible.';
  if (name === 'NotReadableError') return 'La cámara está en uso por otra aplicación. Ciérrala e intenta de nuevo.';
  return 'No se pudo abrir la cámara.';
}

/**
 * Escáner de cámara a pantalla completa para el punto de venta.
 *
 * Se queda abierto leyendo: cada código distinto que entra al cuadro se
 * emite en `scanned` y el padre decide qué hacer (buscar el producto,
 * agregarlo al ticket) y responde con `status`, que se muestra sobre la imagen.
 */
@Component({
  selector: 'app-scanner',
  template: `
    <div class="scan" role="dialog" aria-modal="true" aria-label="Escanear productos">
      <video #video playsinline muted autoplay></video>
      <div class="shade"></div>

      <header class="bar">
        <strong>Escanear productos</strong>
        <span class="bar-spacer"></span>
        @if (torchSupported()) {
          <button type="button" class="icon" [class.on]="torchOn()" (click)="toggleTorch()"
            [attr.aria-pressed]="torchOn()" aria-label="Linterna">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M7 2h10l-2 8h-6z"/><path d="M9 10v3a3 3 0 0 0 6 0v-3"/><line x1="12" y1="17" x2="12" y2="22"/>
            </svg>
          </button>
        }
        <button type="button" class="icon" (click)="closed.emit()" aria-label="Cerrar escáner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </header>

      @if (state() === 'ready') {
        <div class="reticle" aria-hidden="true"><i></i><i></i><i></i><i></i><span class="line"></span></div>
        <p class="hint">Apunta al código de barras o QR del producto</p>
      }

      @if (state() === 'starting') {
        <p class="center-msg">Abriendo la cámara…</p>
      }

      @if (state() === 'error') {
        <div class="center-msg error" role="alert">
          <p>{{ errorText() }}</p>
          <button type="button" class="done" (click)="closed.emit()">Cerrar</button>
        </div>
      }

      <footer class="foot">
        @if (status(); as s) {
          @for (k of [s.n]; track k) {
            <div class="result" [class.ok]="s.ok" [class.fail]="!s.ok" role="status">{{ s.text }}</div>
          }
        }
        <div class="summary">
          <span>{{ summary() }}</span>
          <button type="button" class="done" (click)="closed.emit()">Listo</button>
        </div>
      </footer>
    </div>
  `,
  styles: [`
    :host { display: contents; }

    .scan {
      position: fixed;
      inset: 0;
      z-index: 90;
      display: flex;
      flex-direction: column;
      background: #000;
      color: #fff;
      font-family: 'Inter', system-ui, sans-serif;
      animation: in 0.25s ease backwards;
    }

    video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }

    .shade {
      position: absolute;
      inset: 0;
      pointer-events: none;
      background:
        linear-gradient(180deg, rgba(0, 0, 0, 0.65), transparent 22%, transparent 55%, rgba(0, 0, 0, 0.8));
    }

    .bar {
      position: relative;
      z-index: 2;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: max(14px, env(safe-area-inset-top)) 16px 10px;

      strong { font-size: 17px; font-weight: 700; }
    }

    .bar-spacer { flex: 1; }

    .icon {
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      border: 1px solid rgba(255, 255, 255, 0.3);
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.14);
      backdrop-filter: blur(8px);
      color: #fff;
      cursor: pointer;

      &.on { background: #fde68a; color: #27272a; border-color: #fde68a; }
      &:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    }

    // El marco donde se debe poner el código.
    .reticle {
      position: absolute;
      top: 50%;
      left: 50%;
      width: min(72vw, 300px);
      aspect-ratio: 1;
      transform: translate(-50%, -58%);
      pointer-events: none;

      i {
        position: absolute;
        width: 34px;
        height: 34px;
        border: 4px solid #fff;
        filter: drop-shadow(0 0 6px rgba(0, 0, 0, 0.6));

        &:nth-child(1) { top: 0; left: 0; border-right: 0; border-bottom: 0; border-top-left-radius: 14px; }
        &:nth-child(2) { top: 0; right: 0; border-left: 0; border-bottom: 0; border-top-right-radius: 14px; }
        &:nth-child(3) { bottom: 0; left: 0; border-right: 0; border-top: 0; border-bottom-left-radius: 14px; }
        &:nth-child(4) { bottom: 0; right: 0; border-left: 0; border-top: 0; border-bottom-right-radius: 14px; }
      }

      .line {
        position: absolute;
        left: 8%;
        right: 8%;
        height: 2px;
        top: 10%;
        background: linear-gradient(90deg, transparent, #ffffff 20%, #ffffff 50%, #ffffff 80%, transparent);
        box-shadow: 0 0 14px #ffffff;
        animation: sweep 2.2s ease-in-out infinite alternate;
      }
    }

    .hint {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(50% + min(36vw, 150px) + 4px);
      margin: 0;
      text-align: center;
      font-size: 13.5px;
      color: rgba(255, 255, 255, 0.85);
      text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
      pointer-events: none;
    }

    .center-msg {
      position: absolute;
      top: 50%;
      left: 50%;
      width: min(86vw, 340px);
      margin: 0;
      transform: translate(-50%, -50%);
      text-align: center;
      font-size: 15px;
      line-height: 1.5;

      &.error {
        padding: 22px;
        border-radius: 22px;
        background: rgba(10, 10, 11, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.25);
        p { margin: 0 0 16px; }
      }
    }

    .foot {
      position: relative;
      z-index: 2;
      display: flex;
      flex-direction: column;
      gap: 10px;
      margin-top: auto;
      padding: 0 16px max(16px, env(safe-area-inset-bottom));
    }

    .result {
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 15px;
      font-weight: 600;
      backdrop-filter: blur(10px);
      animation: pop 0.28s cubic-bezier(0.34, 1.56, 0.64, 1) backwards;

      &.ok   { background: rgba(16, 185, 129, 0.88); }
      &.fail { background: rgba(220, 38, 38, 0.9); }
    }

    .summary {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 10px 10px 10px 18px;
      border-radius: 20px;
      background: rgba(10, 10, 11, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.2);
      backdrop-filter: blur(12px);
      font-size: 15px;
      font-weight: 600;

      span { flex: 1; font-variant-numeric: tabular-nums; }
    }

    .done {
      padding: 12px 22px;
      border: 0;
      border-radius: 14px;
      background: linear-gradient(180deg, #ffffff, #dcdce0);
      color: #0a0a0b;
      font: inherit;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;

      &:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
    }

    @keyframes in { from { opacity: 0; } to { opacity: 1; } }
    @keyframes pop { from { opacity: 0; transform: scale(0.9); } to { opacity: 1; transform: scale(1); } }
    @keyframes sweep { from { top: 10%; } to { top: 88%; } }

    @media (prefers-reduced-motion: reduce) {
      .scan, .result { animation: none; }
      .reticle .line { animation: none; top: 50%; }
    }
  `],
})
export class ScannerComponent implements AfterViewInit, OnDestroy {
  /** Resultado de la última lectura, calculado por quien usa el escáner. */
  status = input<ScanStatus | null>(null);
  /** Línea de resumen sobre el botón "Listo" (por ejemplo, "3 en el ticket · $164.00"). */
  summary = input<string>('');

  scanned = output<string>();
  closed = output<void>();

  private video = viewChild.required<ElementRef<HTMLVideoElement>>('video');

  state = signal<'starting' | 'ready' | 'error'>('starting');
  errorText = signal('');
  torchSupported = signal(false);
  torchOn = signal(false);

  private stream: MediaStream | null = null;
  private detector: Detector | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private audio: AudioContext | null = null;
  private destroyed = false;
  private debouncer = new ScanDebouncer();

  ngAfterViewInit(): void {
    void this.start();
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.stream?.getTracks().forEach(t => t.stop());
    this.audio?.close().catch(() => undefined);
  }

  private fail(message: string): void {
    this.errorText.set(message);
    this.state.set('error');
  }

  private async start(): Promise<void> {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      this.fail('La cámara solo funciona en una conexión segura (https) y en un navegador compatible.');
      return;
    }

    // El sonido necesita un gesto del usuario: el escáner se abre con un toque, así que aquí ya se puede.
    try { this.audio = new AudioContext(); } catch { /* sin sonido: queda la vista */ }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch (e) {
      this.fail(explain(e));
      return;
    }

    if (this.destroyed) {
      this.stream.getTracks().forEach(t => t.stop());
      return;
    }

    const el = this.video().nativeElement;
    el.muted = true;                 // iOS solo reproduce solo si está en silencio
    el.srcObject = this.stream;
    try { await el.play(); } catch { /* el atributo autoplay lo reintenta */ }

    const caps = (this.stream.getVideoTracks()[0]?.getCapabilities?.() ?? {}) as { torch?: boolean };
    this.torchSupported.set(!!caps.torch);

    try {
      this.detector = await createDetector();
    } catch {
      this.fail('No se pudo cargar el lector de códigos. Revisa tu conexión e intenta de nuevo.');
      return;
    }
    if (this.destroyed) return;

    this.state.set('ready');
    void this.tick();
  }

  private async tick(): Promise<void> {
    if (this.destroyed) return;

    const el = this.video().nativeElement;
    try {
      if (!document.hidden && el.readyState >= 2 && this.detector) {
        const found = await this.detector.detect(el);
        const code = cleanScan(found[0]?.rawValue);
        if (code && this.debouncer.accept(code)) {
          this.feedback();
          this.scanned.emit(code);
        }
      }
    } catch {
      /* un cuadro que no se pudo leer no detiene el escáner */
    }

    this.timer = setTimeout(() => void this.tick(), TICK_MS);
  }

  /** Pitido y vibración: con el teléfono en la mano, la vista no siempre está en la pantalla. */
  private feedback(): void {
    navigator.vibrate?.(40);
    const ctx = this.audio;
    if (!ctx) return;
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch { /* sin sonido */ }
  }

  async toggleTorch(): Promise<void> {
    const track = this.stream?.getVideoTracks()[0];
    if (!track) return;
    const next = !this.torchOn();
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      this.torchOn.set(next);
    } catch {
      this.torchSupported.set(false);
    }
  }
}
