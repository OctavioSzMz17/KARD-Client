import { Component, computed, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { AuthService } from '../../core/services/auth.service';
import {
  PASSWORD_HINT, PASSWORD_MIN, PASSWORD_RULE, recoveryErrorMessage, tokenFromFragment,
} from './recovery-logic';

/** Qué pide la pantalla: el correo para recibir el enlace, o la contraseña nueva. Sale de la ruta. */
export type RecoveryMode = 'ask' | 'reset';

/** En qué paso va. */
export type RecoveryStep = 'form' | 'sent' | 'done' | 'broken';

function passwordsMatch(group: AbstractControl) {
  return group.get('password')?.value === group.get('confirm')?.value ? null : { passwordMismatch: true };
}

/**
 * Recuperar la contraseña por correo, para cualquiera (dueño, gerencia, empleado o cliente).
 *
 *   /recuperar     — escribe su correo; el servidor contesta lo mismo exista o no (no revela quién
 *                    está registrado), así que aquí tampoco se muestra nada que lo delate.
 *   /restablecer   — llega desde el correo con el token en el `#`; elige la contraseña nueva.
 */
@Component({
  selector: 'app-password-recovery',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './password-recovery.component.html',
  styleUrl: './password-recovery.component.scss',
})
export class PasswordRecoveryComponent {
  private fb    = inject(FormBuilder);
  private auth  = inject(AuthService);
  private route = inject(ActivatedRoute);

  readonly mode: RecoveryMode = this.route.snapshot?.data?.['mode'] === 'reset' ? 'reset' : 'ask';
  readonly esReset = this.mode === 'reset';

  /** Solo en /restablecer: el enlace del correo. Si falta o está cortado, no hay nada que hacer aquí. */
  private readonly token = this.esReset ? tokenFromFragment(this.route.snapshot?.fragment) : null;

  readonly audience = signal<'negocio' | 'cliente'>(this.initialAudience());
  readonly step = signal<RecoveryStep>(this.esReset && !this.token ? 'broken' : 'form');
  readonly loading = signal(false);
  readonly error = signal('');
  readonly showPassword = signal(false);

  readonly passwordHint = PASSWORD_HINT;

  readonly askForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  readonly resetForm = this.fb.group({
    password: ['', [Validators.required, Validators.minLength(PASSWORD_MIN), Validators.pattern(PASSWORD_RULE)]],
    confirm:  ['', [Validators.required]],
  }, { validators: passwordsMatch });

  readonly title = computed(() => {
    switch (this.step()) {
      case 'sent':   return 'Revisa tu correo';
      case 'done':   return 'Contraseña actualizada';
      case 'broken': return 'Enlace incompleto';
      default:       return this.esReset ? 'Crea tu contraseña nueva' : 'Recupera tu contraseña';
    }
  });

  readonly subtitle = computed(() => {
    switch (this.step()) {
      case 'sent':   return 'Si ese correo está registrado, te enviamos un enlace. Dura 1 hora y sirve una sola vez.';
      case 'done':   return 'Ya puedes iniciar sesión con tu contraseña nueva. Cerramos las sesiones que tenías abiertas.';
      case 'broken': return 'Este enlace está cortado o ya no sirve. Pide uno nuevo y ábrelo completo desde tu correo.';
      default:       return this.esReset
        ? 'Elige una contraseña que no uses en otro lado.'
        : 'Escribe tu correo y te mandamos un enlace para crear una contraseña nueva.';
    }
  });

  get emailControl()    { return this.askForm.controls.email; }
  get passwordControl() { return this.resetForm.controls.password; }
  get confirmControl()  { return this.resetForm.controls.confirm; }

  setAudience(audience: 'negocio' | 'cliente'): void {
    this.audience.set(audience);
    this.error.set('');
  }

  /** Pedir el enlace. */
  onAsk(): void {
    // Los teclados del celular suelen dejar un espacio al final; no es motivo para decir "correo inválido".
    this.emailControl.setValue((this.emailControl.value ?? '').trim());
    if (this.askForm.invalid) {
      this.askForm.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set('');

    this.auth.forgotPassword(this.emailControl.value!, this.audience()).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set('sent');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(recoveryErrorMessage(err.status, err.error?.code));
      },
    });
  }

  /** Guardar la contraseña nueva. */
  onReset(): void {
    if (this.resetForm.invalid || !this.token) {
      this.resetForm.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set('');

    this.auth.resetPassword(this.token, this.passwordControl.value!).subscribe({
      next: () => {
        this.loading.set(false);
        this.step.set('done');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        // Un enlace que el servidor rechaza ya no tiene remedio aquí: se manda a pedir otro.
        if (err.status === 400 && err.error?.code === 'INVALID_RESET_TOKEN') {
          this.step.set('broken');
          return;
        }
        this.error.set(recoveryErrorMessage(err.status, err.error?.code));
      },
    });
  }

  /** Vuelve a pedir otro enlace sin salir de la pantalla. */
  askAgain(): void {
    this.step.set('form');
    this.error.set('');
  }

  // Lo último que la persona usó en el login (negocio o cliente), o lo que diga la dirección.
  private initialAudience(): 'negocio' | 'cliente' {
    const fromUrl = this.route.snapshot?.queryParamMap?.get('tipo');
    if (fromUrl === 'negocio' || fromUrl === 'cliente') return fromUrl;
    try {
      const saved = localStorage.getItem('kard_auth_tipo');
      if (saved === 'negocio' || saved === 'cliente') return saved;
    } catch { /* almacenamiento bloqueado: se usa el valor por defecto */ }
    return 'cliente';
  }
}
