import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

@Component({
  selector: 'app-login',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required]
  });

  loading = signal(false);
  error = signal('');
  showPassword = signal(false);

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const { email, password } = this.form.value;
    const credentials = { email: email!, password: password! };

    // Dos identidades separadas en la plataforma: primero intenta como
    // usuario B2B (negocio); si las credenciales no existen ahí, intenta
    // como consumer (cliente). Cada una redirige a su vista.
    this.auth.login(credentials).subscribe({
      next: () => this.router.navigate(['/dashboard']),
      error: (err) => {
        if (err.status >= 400 && err.status < 500) {
          this.tryConsumerLogin(credentials);
        } else {
          this.loading.set(false);
          this.error.set(err.error?.error ?? 'Error al iniciar sesión. Intenta de nuevo.');
        }
      }
    });
  }

  private tryConsumerLogin(credentials: { email: string; password: string }): void {
    this.auth.loginConsumer(credentials).subscribe({
      next: () => this.router.navigate(['/explore']),
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error ?? 'Correo o contraseña incorrectos.');
      }
    });
  }

  get emailControl() { return this.form.get('email'); }
  get passwordControl() { return this.form.get('password'); }
}
