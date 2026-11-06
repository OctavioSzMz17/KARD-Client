import { Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';
import { BUBBLES, BUSINESS_PHOTO, CLIENT_PHOTO } from '../../shared/brand-images';

/** Qué pide la página: entrar o crear cuenta. Sale de la ruta (/login, /register). */
export type AuthMode = 'login' | 'register';

/** Quién la usa: un cliente que compra o un negocio que vende. */
export type AuthAudience = 'cliente' | 'negocio';

const AUDIENCE_KEY = 'kard_auth_tipo';

/** Una burbuja en la simulación: posición del centro y velocidad, en px (y px/s). */
interface Ball {
  el: HTMLElement;
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  /** Rapidez a la que tiende al deambular. */
  speed: number;
}

/** La caja invisible donde flotan, en px dentro del panel de burbujas. */
interface Box { x0: number; y0: number; x1: number; y1: number; }

/** Solo se exige igualdad cuando el campo de confirmación está activo (registro). */
function passwordMatchValidator(group: AbstractControl) {
  const confirm = group.get('confirmPassword');
  if (!confirm || confirm.disabled) return null;
  return group.get('password')?.value === confirm.value ? null : { passwordMismatch: true };
}

/**
 * Una sola pantalla para entrar y registrarse, con un interruptor Cliente /
 * Negocio.
 *
 * El interruptor decide contra qué identidad se autentica: antes el login
 * probaba primero como negocio y, si fallaba, como cliente, lo que ocultaba
 * de qué cuenta se trataba y mezclaba los errores. Ahora cada opción llama
 * a su propio endpoint y nada más.
 */
@Component({
  selector: 'app-auth-page',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss'
})
export class AuthPageComponent {
  private fb     = inject(FormBuilder);
  private auth   = inject(AuthService);
  private router = inject(Router);
  private route  = inject(ActivatedRoute);

  mode     = signal<AuthMode>('login');
  audience = signal<AuthAudience>(this.initialAudience());

  loading      = signal(false);
  error        = signal('');
  showPassword = signal(false);

  form = this.fb.group({
    // solo registro de cliente (opcional)
    name:          [''],
    // solo registro de negocio
    business_name: [''],
    business_type: ['restaurant' as 'restaurant' | 'optician'],
    // siempre
    email:         ['', [Validators.required, Validators.email]],
    password:      ['', Validators.required],
    // solo registro
    confirmPassword: [''],
  }, { validators: passwordMatchValidator });

  // ── Fondo ───────────────────────────────────────────────
  readonly clientPhoto   = `url(${CLIENT_PHOTO})`;
  readonly businessPhoto = `url(${BUSINESS_PHOTO})`;
  readonly bubbles = BUBBLES.map(b => ({ ...b, bg: `url(${b.img})` }));

  // ── Panel en vivo (lado izquierdo del modo Negocio) ─────
  // Datos de ejemplo que laten solos: es lo que un dueño verá al entrar, no
  // información real de nadie. Se mantienen genéricos a propósito: la
  // plataforma es multi-negocio (restaurantes, ópticas, lo que venga), así que
  // aquí no hay platillos, mesas ni lentes, solo cosas que existen en cualquier
  // negocio: ventas, pedidos con su modo de entrega e inventario.
  readonly ventas      = signal(4820);
  readonly ventasSerie = signal<number[]>([4310, 4390, 4402, 4515, 4560, 4601, 4688, 4724, 4790, 4820]);
  readonly pedidos     = signal<{ id: number; who: string; items: number; mode: string; total: number }[]>([
    { id: 1042, who: 'Ana',   items: 3, mode: 'A domicilio', total: 318 },
    { id: 1041, who: 'Luis',  items: 2, mode: 'En el local', total: 245 },
    { id: 1040, who: 'Sofía', items: 1, mode: 'Para llevar', total: 129 },
  ]);

  readonly productosActivos = 128;
  readonly stockBajo = signal(7);
  /** Qué parte del catálogo tiene existencias suficientes. */
  readonly saludInventario = computed(() => Math.round((1 - this.stockBajo() / this.productosActivos) * 100));

  /** Circunferencia de la dona (r = 22), para dibujar el arco como `trazo vacío`. */
  private static readonly DONA = 2 * Math.PI * 22;
  readonly donaTrazo = computed(() => {
    const lleno = (this.saludInventario() / 100) * AuthPageComponent.DONA;
    return `${lleno.toFixed(1)} ${AuthPageComponent.DONA.toFixed(1)}`;
  });

  readonly ventasTexto = computed(() => '$' + this.ventas().toLocaleString('es-MX'));

  /** Puntos de la línea de tendencia, ajustados al alto del recuadro (viewBox 120×32). */
  readonly sparkPoints = computed(() => {
    const serie = this.ventasSerie();
    const min = Math.min(...serie), max = Math.max(...serie);
    const alto = Math.max(max - min, 1);
    return serie
      .map((v, i) => `${((i / (serie.length - 1)) * 120).toFixed(1)},${(28 - ((v - min) / alto) * 24).toFixed(1)}`)
      .join(' ');
  });

  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  // Simulación de las burbujas
  private balls: Ball[] = [];
  private box: Box = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private bubbleFrame = 0;
  private lastFrame = 0;
  /** Hasta cuándo corre: sin fin en Cliente; tras salir, un momento, para no congelarse a media transición. */
  private bubblesUntil = Infinity;
  private bubblesReady = false;
  private calmMotion = false;

  private liveTimer?: ReturnType<typeof setInterval>;
  private nextOrderId = 1043;
  private pointerFrame = 0;

  readonly esRegistro = computed(() => this.mode() === 'register');
  readonly esNegocio  = computed(() => this.audience() === 'negocio');

  readonly title = computed(() => {
    if (this.esRegistro()) return this.esNegocio() ? 'Registra tu negocio' : 'Crea tu cuenta';
    return this.esNegocio() ? 'Panel del negocio' : 'Bienvenido de nuevo';
  });

  readonly subtitle = computed(() => {
    if (this.esRegistro()) {
      return this.esNegocio()
        ? 'Crea la cuenta de tu negocio y publica tu tienda'
        : 'Pide en los negocios cerca de ti, sin complicaciones';
    }
    return this.esNegocio()
      ? 'Inicia sesión para administrar tu inventario y tus ventas'
      : 'Entra para explorar y pedir en tus negocios favoritos';
  });

  readonly submitLabel = computed(() => {
    if (!this.esRegistro()) return 'Iniciar sesión';
    return this.esNegocio() ? 'Registrar negocio' : 'Crear cuenta';
  });

  constructor() {
    // El panel en vivo solo late mientras se ve: en el lado Cliente está oculto.
    effect(() => (this.audience() === 'negocio' ? this.startLive() : this.stopLive()));

    // Las burbujas, al revés: solo se simulan en el lado Cliente. Al salir
    // siguen un instante para que no se congelen mientras se desvanecen.
    effect(() => {
      const cliente = this.audience() === 'cliente';
      this.bubblesUntil = cliente ? Infinity : performance.now() + 900;
      if (cliente && this.bubblesReady) this.kickBubbles();
    });

    afterNextRender(() => {
      this.calmMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.addEventListener('resize', this.onResize, { passive: true });
      this.collectBubbles(true);
      this.bubblesReady = true;
      this.kickBubbles();
    });

    inject(DestroyRef).onDestroy(() => {
      this.stopLive();
      cancelAnimationFrame(this.pointerFrame);
      cancelAnimationFrame(this.bubbleFrame);
      window.removeEventListener('resize', this.onResize);
    });

    // Como /login y /register comparten ruta, la página no se reconstruye al
    // pasar de una a otra: solo cambia el modo, y el formulario se reajusta.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.mode.set(params.get('mode') === 'register' ? 'register' : 'login');
      this.applyContext();
    });
  }

  /**
   * Parallax: el cursor desplaza las burbujas y las fotos según su
   * profundidad. Solo escribe dos variables CSS (-1 a 1) por cuadro; el
   * movimiento lo hace el navegador.
   */
  onPointer(event: PointerEvent): void {
    const stage = event.currentTarget as HTMLElement;
    const { clientX, clientY } = event;
    cancelAnimationFrame(this.pointerFrame);
    this.pointerFrame = requestAnimationFrame(() => {
      stage.style.setProperty('--mx', String((clientX / window.innerWidth - 0.5) * 2));
      stage.style.setProperty('--my', String((clientY / window.innerHeight - 0.5) * 2));
    });
  }

  // ══ Burbujas flotando ═══════════════════════════════════════════
  //
  // Cada burbuja deambula: gira su rumbo un poco al azar en cada cuadro,
  // rebota con las paredes de la caja invisible y, si choca con otra, se
  // empujan como bolas de billar blandas (las grandes pesan más). El
  // navegador solo recibe un `transform` por burbuja y cuadro.

  private readonly onResize = () => this.collectBubbles(false);

  /** Caja de vuelo, en píxeles del panel: el lado derecho de la diagonal (o la mitad de abajo en celular). */
  private computeBox(stage: HTMLElement): Box {
    const w = stage.clientWidth, h = stage.clientHeight;
    // El panel mide 106 % de la pantalla y empieza un 3 % antes de su borde.
    const ox = w * 0.03, oy = h * 0.03;
    if (w <= 820) return { x0: ox, y0: oy + h * 0.6, x1: ox + w, y1: oy + h };
    // Se queda a la derecha de la diagonal (su punto más a la derecha es 59 %).
    return { x0: ox + w * (w <= 1180 ? 0.64 : 0.61), y0: oy, x1: ox + w, y1: oy + h };
  }

  /**
   * Reúne las burbujas visibles y mide sus radios. Al iniciar las coloca al
   * azar sin que se encimen; al redimensionar conserva su lugar y solo las
   * mete en la caja nueva.
   */
  private collectBubbles(place: boolean): void {
    const stage = this.stage().nativeElement;
    this.box = this.computeBox(stage);
    const els = Array.from(stage.querySelectorAll<HTMLElement>('.bubble')).filter(el => el.offsetWidth > 0);
    const known = new Map(this.balls.map(b => [b.el, b]));
    const calm = this.calmMotion ? 0.8 : 1;

    this.balls = els.map(el => {
      const old = known.get(el);
      const r = el.offsetWidth / 2;
      if (old) { old.r = r; return old; }
      // Las grandes se mueven un poco más despacio: pesan más y están más cerca.
      const speed = (52 + Math.random() * 46) * Math.pow(100 / (r * 2), 0.25) * calm;
      const angle = Math.random() * Math.PI * 2;
      return { el, x: 0, y: 0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r, speed };
    });

    const { x0, y0, x1, y1 } = this.box;
    this.balls.forEach((ball, i) => {
      if (!place && known.has(ball.el)) return;
      // Hasta 40 intentos de caer libre de las ya colocadas; si no, donde caiga.
      for (let tries = 0; tries < 40; tries++) {
        ball.x = x0 + ball.r + Math.random() * Math.max(1, x1 - x0 - 2 * ball.r);
        ball.y = y0 + ball.r + Math.random() * Math.max(1, y1 - y0 - 2 * ball.r);
        const libre = this.balls.slice(0, i).every(o => Math.hypot(o.x - ball.x, o.y - ball.y) > o.r + ball.r + 8);
        if (libre) break;
      }
    });

    // Tras redimensionar, nadie debe quedar fuera de la caja nueva.
    for (const b of this.balls) this.clampToBox(b);
    this.paintBubbles(true);
  }

  private clampToBox(b: Ball): void {
    const { x0, y0, x1, y1 } = this.box;
    b.x = Math.min(Math.max(b.x, x0 + b.r), Math.max(x0 + b.r, x1 - b.r));
    b.y = Math.min(Math.max(b.y, y0 + b.r), Math.max(y0 + b.r, y1 - b.r));
  }

  private paintBubbles(reveal = false): void {
    for (const b of this.balls) {
      b.el.style.transform = `translate3d(${(b.x - b.r).toFixed(1)}px, ${(b.y - b.r).toFixed(1)}px, 0)`;
      if (reveal) b.el.style.opacity = '1';
    }
  }

  private kickBubbles(): void {
    if (this.bubbleFrame) return;   // ya está corriendo
    this.lastFrame = performance.now();
    this.bubbleFrame = requestAnimationFrame(this.stepBubbles);
  }

  private readonly stepBubbles = (now: number): void => {
    this.bubbleFrame = 0;
    if (now > this.bubblesUntil) return;   // fuera del lado Cliente: se detiene hasta volver

    // Si la pestaña estuvo en segundo plano, el salto de tiempo no debe lanzarlas por la pantalla.
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    const { x0, y0, x1, y1 } = this.box;
    const balls = this.balls;

    for (const b of balls) {
      // Deambular: un giro de rumbo al azar, de hasta ±1.6 rad/s…
      const turn = (Math.random() - 0.5) * 3.2 * dt;
      const cos = Math.cos(turn), sin = Math.sin(turn);
      const vx = b.vx * cos - b.vy * sin;
      b.vy = b.vx * sin + b.vy * cos;
      b.vx = vx;
      // …y la rapidez regresa suavemente a la suya, para que no se frenen ni se disparen.
      const sp = Math.hypot(b.vx, b.vy) || 1;
      const k = 1 + ((b.speed - sp) / sp) * Math.min(1, 2 * dt);
      b.vx *= k; b.vy *= k;

      b.x += b.vx * dt;
      b.y += b.vy * dt;

      // Rebote en las paredes.
      if (b.x - b.r < x0) { b.x = x0 + b.r; b.vx = Math.abs(b.vx); }
      if (b.x + b.r > x1) { b.x = x1 - b.r; b.vx = -Math.abs(b.vx); }
      if (b.y - b.r < y0) { b.y = y0 + b.r; b.vy = Math.abs(b.vy); }
      if (b.y + b.r > y1) { b.y = y1 - b.r; b.vy = -Math.abs(b.vy); }
    }

    // Choques entre burbujas: se separan y se intercambian impulso (masa ∝ r²).
    for (let i = 0; i < balls.length; i++) {
      for (let j = i + 1; j < balls.length; j++) {
        const a = balls[i], c = balls[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const min = a.r + c.r;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 === 0) continue;

        const dist = Math.sqrt(d2);
        const nx = dx / dist, ny = dy / dist;
        const ma = a.r * a.r, mc = c.r * c.r;
        const overlap = min - dist;
        a.x -= nx * overlap * (mc / (ma + mc)); a.y -= ny * overlap * (mc / (ma + mc));
        c.x += nx * overlap * (ma / (ma + mc)); c.y += ny * overlap * (ma / (ma + mc));

        const vn = (a.vx - c.vx) * nx + (a.vy - c.vy) * ny;
        if (vn > 0) {   // se acercaban
          const impulso = (1.85 * vn) / (1 / ma + 1 / mc);
          a.vx -= (impulso / ma) * nx; a.vy -= (impulso / ma) * ny;
          c.vx += (impulso / mc) * nx; c.vy += (impulso / mc) * ny;
        }
      }
    }

    this.paintBubbles();
    this.bubbleFrame = requestAnimationFrame(this.stepBubbles);
  };

  private startLive(): void {
    if (this.liveTimer) return;
    const quienes = ['Marco', 'Elena', 'Diego', 'Valeria', 'Pablo', 'Lucía'];
    const modos   = ['En el local', 'A domicilio', 'Para llevar', 'Recoger'];
    let tick = 0;

    this.liveTimer = setInterval(() => {
      tick++;
      const suma = 45 + Math.floor(Math.random() * 140);
      this.ventas.update(v => v + suma);
      this.ventasSerie.update(serie => [...serie.slice(1), this.ventas()]);

      // Un pedido nuevo cada dos ticks, para que la lista no se agite demasiado.
      if (tick % 2 === 0) {
        const nuevo = {
          id: this.nextOrderId++,
          who: quienes[Math.floor(Math.random() * quienes.length)],
          items: 1 + Math.floor(Math.random() * 4),
          mode: modos[Math.floor(Math.random() * modos.length)],
          total: 90 + Math.floor(Math.random() * 280),
        };
        this.pedidos.update(lista => [nuevo, ...lista.slice(0, 2)]);
      }

      // De vez en cuando el inventario se mueve: se repone o se agota algo.
      if (tick % 3 === 0) {
        this.stockBajo.update(n => Math.min(11, Math.max(4, n + (Math.random() < 0.5 ? -1 : 1))));
      }
    }, 1900);
  }

  private stopLive(): void {
    if (this.liveTimer) clearInterval(this.liveTimer);
    this.liveTimer = undefined;
  }

  setAudience(audience: AuthAudience): void {
    if (audience === this.audience()) return;
    this.audience.set(audience);
    this.rememberAudience(audience);
    this.applyContext();
    // Queda en la URL para poder compartir o recargar el mismo lado.
    this.router.navigate([], {
      relativeTo: this.route, queryParams: { tipo: audience },
      queryParamsHandling: 'merge', replaceUrl: true,
    });
  }

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const v = this.form.getRawValue();
    const credentials = { email: v.email!, password: v.password! };
    const negocio = this.esNegocio();

    const request$: Observable<unknown> = this.esRegistro()
      ? (negocio
          ? this.auth.registerTenant({
              business_name: v.business_name!.trim(),
              business_type: v.business_type!,
              ...credentials,
            })
          : this.auth.registerConsumer({
              ...credentials,
              ...(v.name?.trim() ? { name: v.name.trim() } : {}),
            }))
      : (negocio ? this.auth.login(credentials) : this.auth.loginConsumer(credentials));

    request$.subscribe({
      next: () => {
        this.rememberAudience(this.audience());
        this.router.navigate([negocio ? '/dashboard' : '/explore']);
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.messageFor(err));
      }
    });
  }

  /**
   * Activa solo los campos del contexto: los desactivados no cuentan para la
   * validez del formulario ni salen en su valor, así que no hace falta
   * limpiar ni ignorar nada al enviar.
   */
  private applyContext(): void {
    const registro = this.esRegistro();
    const negocio  = this.esNegocio();
    const f = this.form.controls;

    this.setEnabled(f.name,            registro && !negocio);
    this.setEnabled(f.business_name,   registro && negocio);
    this.setEnabled(f.business_type,   registro && negocio);
    this.setEnabled(f.confirmPassword, registro);

    f.business_name.setValidators(registro && negocio ? [Validators.required, Validators.minLength(2)] : []);
    f.confirmPassword.setValidators(registro ? [Validators.required] : []);
    f.password.setValidators(registro
      ? [Validators.required, Validators.minLength(8), Validators.pattern(/^(?=.*[a-zA-Z])(?=.*\d).+$/)]
      : [Validators.required]);

    for (const c of [f.business_name, f.confirmPassword, f.password]) c.updateValueAndValidity({ emitEvent: false });
    this.form.updateValueAndValidity({ emitEvent: false });

    // Lo escrito en un lado no debería mostrar errores en el otro.
    this.error.set('');
    this.form.markAsUntouched();
    f.confirmPassword.reset('', { emitEvent: false });
  }

  private setEnabled(control: AbstractControl, enabled: boolean): void {
    if (enabled && control.disabled) control.enable({ emitEvent: false });
    if (!enabled && control.enabled) control.disable({ emitEvent: false });
  }

  /** Mensajes en español según lo que respondió el servidor (que contesta en inglés). */
  private messageFor(err: HttpErrorResponse): string {
    if (err.status === 0)   return 'No pudimos conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
    if (err.status === 401) return 'Correo o contraseña incorrectos.';
    if (err.status === 403) return 'Demasiados intentos fallidos. Tu cuenta quedó bloqueada unos minutos; intenta más tarde.';
    if (err.status === 422) return 'Revisa los datos: alguno no tiene el formato esperado.';
    if (err.status === 400 && /ya está registrado|already registered/i.test(err.error?.error ?? '')) {
      return 'Ya existe una cuenta con ese correo. Inicia sesión.';
    }
    if (err.status >= 500)  return 'Algo salió mal de nuestro lado. Intenta de nuevo en un momento.';
    return 'No se pudo completar la solicitud. Intenta de nuevo.';
  }

  // ── Qué lado se muestra al abrir la página ──────────────
  // Prioridad: lo que diga la URL (?tipo=negocio), luego lo último que la
  // persona usó, y por último cliente, que es quien más entra.
  private initialAudience(): AuthAudience {
    const fromUrl = this.route.snapshot?.queryParamMap?.get('tipo');
    if (fromUrl === 'negocio' || fromUrl === 'cliente') return fromUrl;
    try {
      const saved = localStorage.getItem(AUDIENCE_KEY);
      if (saved === 'negocio' || saved === 'cliente') return saved;
    } catch { /* almacenamiento bloqueado: se usa el valor por defecto */ }
    return 'cliente';
  }

  private rememberAudience(audience: AuthAudience): void {
    try { localStorage.setItem(AUDIENCE_KEY, audience); } catch { /* es solo una comodidad */ }
  }

  get nameControl()     { return this.form.get('name'); }
  get businessControl() { return this.form.get('business_name'); }
  get typeControl()     { return this.form.get('business_type'); }
  get emailControl()    { return this.form.get('email'); }
  get passwordControl() { return this.form.get('password'); }
  get confirmControl()  { return this.form.get('confirmPassword'); }
}
