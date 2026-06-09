import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth.service';

function passwordMatchValidator(group: import('@angular/forms').AbstractControl) {
  const password = group.get('password')?.value;
  const confirm = group.get('confirmPassword')?.value;
  return password === confirm ? null : { passwordMismatch: true };
}

@Component({
  selector: 'app-register',
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './register.component.html',
  styleUrl: './register.component.scss'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);

  form = this.fb.group({
    business_name: ['', Validators.required],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8), Validators.pattern(/^(?=.*[a-zA-Z])(?=.*\d).+$/)]],
    confirmPassword: ['', Validators.required],
    business_type: ['restaurant' as 'restaurant' | 'optician', Validators.required]
  }, { validators: passwordMatchValidator });

  loading = signal(false);
  error = signal('');
  success = signal('');

  onSubmit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const { business_name, email, business_type } = this.form.value;

    this.auth.register({
      business_name: business_name!,
      email: email!,
      business_type: business_type!
    }).subscribe({
      next: () => {
        this.success.set('Negocio registrado exitosamente. Redirigiendo...');
        setTimeout(() => this.router.navigate(['/login']), 2000);
      },
      error: (err) => {
        this.loading.set(false);
        this.error.set(err.error?.error ?? 'Error al registrar. Intenta de nuevo.');
      }
    });
  }

  get nameControl() { return this.form.get('business_name'); }
  get emailControl() { return this.form.get('email'); }
  get passwordControl() { return this.form.get('password'); }
  get confirmControl() { return this.form.get('confirmPassword'); }
  get typeControl() { return this.form.get('business_type'); }
}
