import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { AuthService } from '../../core/services/auth.service';

/** Qué pide la página: entrar o crear cuenta. Sale de la ruta (/login, /register). */
export type AuthMode = 'login' | 'register';

/** Quién la usa: un cliente que compra o un negocio que vende. */
export type AuthAudience = 'cliente' | 'negocio';

const AUDIENCE_KEY = 'kard_auth_tipo';

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

  readonly tagline = computed(() =>
    this.esNegocio() ? 'Inventario inteligente\npara tu negocio' : 'Descubre y pide en\ntus negocios favoritos'
  );

  readonly submitLabel = computed(() => {
    if (!this.esRegistro()) return 'Iniciar sesión';
    return this.esNegocio() ? 'Registrar negocio' : 'Crear cuenta';
  });

  constructor() {
    // Como /login y /register comparten ruta, la página no se reconstruye al
    // pasar de una a otra: solo cambia el modo, y el formulario se reajusta.
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(params => {
      this.mode.set(params.get('mode') === 'register' ? 'register' : 'login');
      this.applyContext();
    });
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
    if (err.status === 400 && /already registered/i.test(err.error?.error ?? '')) {
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
