import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { AuthService } from '../../core/services/auth.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { PositionOption, TeamMember, TeamService } from '../../core/services/team.service';
import { AuthorizedDevice, DeviceService } from '../../core/services/device.service';
import { PERM } from '../../core/permissions';
import { generatePassword, initialsOf, passwordProblem } from './team-logic';

type Dialog =
  | { kind: 'add' }
  | { kind: 'edit'; member: TeamMember }
  | { kind: 'password'; member: TeamMember }
  | { kind: 'deactivate'; member: TeamMember }
  | null;

/**
 * Equipo: las personas del negocio, su puesto y su código de empleado.
 *
 * La jerarquía la decide el servidor: aquí solo se ofrecen los puestos que
 * quien consulta puede dar (`assignable_positions`) y las acciones sobre quienes
 * puede administrar (`can_manage`).
 */
@Component({
  selector: 'app-team',
  imports: [DatePipe],
  templateUrl: './team.component.html',
  styleUrl: './team.component.scss',
})
export class TeamComponent implements OnInit {
  private svc = inject(TeamService);
  private auth = inject(AuthService);
  private snack = inject(SnackbarService);
  private devices = inject(DeviceService);

  readonly members = signal<TeamMember[]>([]);
  readonly assignable = signal<PositionOption[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  readonly dialog = signal<Dialog>(null);
  readonly saving = signal(false);
  readonly formError = signal<string | null>(null);

  // Formulario (se reutiliza para alta, edición y contraseña).
  readonly fullName = signal('');
  readonly email = signal('');
  readonly password = signal('');
  readonly position = signal('empleado');
  readonly showPassword = signal(true);

  /** La persona recién registrada: se muestra su código y su contraseña inicial una sola vez. */
  readonly justCreated = signal<{ name: string; code: string; email: string; password: string } | null>(null);

  // ── Equipos autorizados (cajas registradoras) ─────────
  readonly canAuthorizeDevices = computed(() => this.auth.can(PERM.devicesAuthorize));
  readonly authorizedDevices = signal<AuthorizedDevice[]>([]);
  /** Dirección que se abre en la computadora que va a ser caja. */
  readonly registerUrl = `${window.location.origin}/caja-registradora`;

  readonly myId = computed(() => this.auth.profile()?.user_id ?? '');
  readonly initials = initialsOf;
  readonly activeCount = computed(() => this.members().filter(m => m.is_active).length);

  ngOnInit(): void {
    this.reload();
    this.loadDevices();
  }

  loadDevices(): void {
    if (!this.canAuthorizeDevices()) return;
    this.devices.list().subscribe({
      next: res => this.authorizedDevices.set(res.items),
      error: () => this.authorizedDevices.set([]),
    });
  }

  revokeDevice(device: AuthorizedDevice): void {
    this.devices.revoke(device.device_id).subscribe({
      next: () => { this.snack.success(`${device.name} ya no está autorizada.`); this.loadDevices(); },
      error: err => this.snack.error(err.error?.error ?? 'No se pudo retirar la autorización.'),
    });
  }

  reload(): void {
    this.loading.set(true);
    this.svc.list().subscribe({
      next: res => {
        this.members.set(res.items);
        this.assignable.set(res.assignable_positions);
        this.loading.set(false);
        this.loadError.set(null);
      },
      error: err => {
        this.loading.set(false);
        this.loadError.set(err.error?.error ?? err.error?.detail ?? 'No se pudo cargar el equipo.');
      },
    });
  }

  // ── Diálogos ──────────────────────────────────────────
  openAdd(): void {
    this.fullName.set('');
    this.email.set('');
    this.password.set(generatePassword());
    this.showPassword.set(true);
    this.position.set(this.assignable().at(-1)?.value ?? 'empleado');   // el más bajo: lo más seguro por defecto
    this.formError.set(null);
    this.dialog.set({ kind: 'add' });
  }

  openEdit(member: TeamMember): void {
    this.fullName.set(member.full_name ?? '');
    this.position.set(member.position);
    this.formError.set(null);
    this.dialog.set({ kind: 'edit', member });
  }

  openPassword(member: TeamMember): void {
    this.password.set(generatePassword());
    this.showPassword.set(true);
    this.formError.set(null);
    this.dialog.set({ kind: 'password', member });
  }

  openDeactivate(member: TeamMember): void {
    this.formError.set(null);
    this.dialog.set({ kind: 'deactivate', member });
  }

  closeDialog(): void {
    if (this.saving()) return;
    this.dialog.set(null);
  }

  regenerate(): void {
    this.password.set(generatePassword());
  }

  // ── Acciones ──────────────────────────────────────────
  submitAdd(): void {
    const name = this.fullName().trim();
    const email = this.email().trim();
    if (name.length < 2) return this.formError.set('Escribe el nombre de la persona.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return this.formError.set('Escribe un correo válido.');
    const problem = passwordProblem(this.password());
    if (problem) return this.formError.set(problem);

    this.saving.set(true);
    this.formError.set(null);
    this.svc.create({ full_name: name, email, password: this.password(), position: this.position() }).subscribe({
      next: created => {
        this.saving.set(false);
        this.dialog.set(null);
        this.justCreated.set({
          name: created.full_name ?? name,
          code: created.employee_code ?? '',
          email: created.email,
          password: this.password(),
        });
        this.reload();
      },
      error: err => {
        this.saving.set(false);
        this.formError.set(this.explain(err, 'No se pudo registrar a la persona.'));
      },
    });
  }

  submitEdit(): void {
    const d = this.dialog();
    if (d?.kind !== 'edit') return;
    const name = this.fullName().trim();
    if (name.length < 2) return this.formError.set('Escribe el nombre de la persona.');

    const changes: { full_name?: string; position?: string } = {};
    if (name !== (d.member.full_name ?? '')) changes.full_name = name;
    if (this.position() !== d.member.position) changes.position = this.position();
    if (!Object.keys(changes).length) return this.closeDialog();

    this.run(this.svc.update(d.member.user_id, changes), 'Cambios guardados.');
  }

  submitPassword(): void {
    const d = this.dialog();
    if (d?.kind !== 'password') return;
    const problem = passwordProblem(this.password());
    if (problem) return this.formError.set(problem);

    this.saving.set(true);
    this.formError.set(null);
    this.svc.resetPassword(d.member.user_id, this.password()).subscribe({
      next: () => {
        this.saving.set(false);
        this.dialog.set(null);
        this.justCreated.set({
          name: d.member.full_name ?? d.member.email,
          code: d.member.employee_code ?? '',
          email: d.member.email,
          password: this.password(),
        });
      },
      error: err => {
        this.saving.set(false);
        this.formError.set(this.explain(err, 'No se pudo restablecer la contraseña.'));
      },
    });
  }

  confirmToggleActive(): void {
    const d = this.dialog();
    if (d?.kind !== 'deactivate') return;
    const next = !d.member.is_active;
    this.run(this.svc.update(d.member.user_id, { is_active: next }), next ? 'Persona reactivada.' : 'Persona dada de baja.');
  }

  /** Reactivar no necesita confirmar: no quita nada. */
  reactivate(member: TeamMember): void {
    this.svc.update(member.user_id, { is_active: true }).subscribe({
      next: () => { this.snack.success('Persona reactivada.'); this.reload(); },
      error: err => this.snack.error(this.explain(err, 'No se pudo reactivar.')),
    });
  }

  dismissCreated(): void {
    this.justCreated.set(null);
  }

  async copyCredentials(): Promise<void> {
    const c = this.justCreated();
    if (!c) return;
    const text = `Correo: ${c.email}\nContraseña: ${c.password}\nCódigo de empleado: ${c.code}`;
    try {
      await navigator.clipboard.writeText(text);
      this.snack.success('Copiado.');
    } catch {
      this.snack.warning('No se pudo copiar; anótalo desde la pantalla.');
    }
  }

  private run(call: ReturnType<TeamService['update']>, ok: string): void {
    this.saving.set(true);
    this.formError.set(null);
    call.subscribe({
      next: () => {
        this.saving.set(false);
        this.dialog.set(null);
        this.snack.success(ok);
        this.reload();
      },
      error: err => {
        this.saving.set(false);
        this.formError.set(this.explain(err, 'No se pudo guardar.'));
      },
    });
  }

  private explain(err: any, fallback: string): string {
    const body = err?.error;
    if (typeof body?.error === 'string') return body.error;
    // Errores de validación de FastAPI (422): se muestra el primero.
    const first = Array.isArray(body?.detail) ? body.detail[0]?.msg : null;
    if (typeof first === 'string') return first.replace(/^Value error, /, '');
    return typeof body?.detail === 'string' ? body.detail : fallback;
  }
}
