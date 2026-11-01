import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CashService, CashSession } from '../../core/services/cash.service';
import { SnackbarService } from '../../core/services/snackbar.service';
import { centsToApi, formatCents, formatMoney, toCents } from '../pos/pos-math';
import { printSheet } from '../pos/print';
import { CutSheetComponent } from './cut-sheet.component';

const PAGE_SIZE = 10;

/**
 * Caja: abrir el turno, ver cómo va, cerrarlo con el corte y consultar los
 * cortes anteriores. Un negocio tiene como máximo un turno abierto.
 */
@Component({
  selector: 'app-cash',
  imports: [DatePipe, RouterLink, CutSheetComponent],
  templateUrl: './cash.component.html',
  styleUrl: './cash.component.scss',
})
export class CashComponent implements OnInit {
  private cashSvc = inject(CashService);
  private snack = inject(SnackbarService);

  readonly money = formatMoney;
  readonly cents = formatCents;

  /** undefined = cargando, null = cerrada, objeto = turno abierto. */
  readonly session = signal<CashSession | null | undefined>(undefined);
  readonly history = signal<CashSession[]>([]);
  readonly historyTotal = signal(0);
  readonly page = signal(1);
  readonly historyLoading = signal(false);

  readonly floatText = signal('');
  readonly countedText = signal('');
  readonly notes = signal('');
  readonly busy = signal(false);
  readonly confirmingClose = signal(false);

  /** Corte que se muestra en el diálogo: el recién cerrado o uno del historial. */
  readonly viewing = signal<CashSession | null>(null);

  readonly pages = computed(() => Math.max(1, Math.ceil(this.historyTotal() / PAGE_SIZE)));

  /** Diferencia en vivo mientras el cajero escribe lo que contó: contado − esperado. */
  readonly liveDifference = computed(() => {
    const s = this.session();
    const counted = toCents(this.countedText());
    if (!s || counted === null) return null;
    return counted - (toCents(s.expected_cash) ?? 0);
  });

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.cashSvc.current().subscribe({
      next: s => this.session.set(s),
      error: () => {
        this.session.set(null);
        this.snack.error('No se pudo consultar la caja.');
      },
    });
    this.loadHistory(this.page());
  }

  loadHistory(page: number): void {
    this.historyLoading.set(true);
    this.cashSvc.sessions(page, PAGE_SIZE).subscribe({
      next: res => {
        this.history.set(res.items.filter(s => s.status === 'closed'));
        this.historyTotal.set(res.total);
        this.page.set(res.page);
        this.historyLoading.set(false);
      },
      error: () => {
        this.historyLoading.set(false);
        this.snack.error('No se pudo cargar el historial de cortes.');
      },
    });
  }

  open(): void {
    const cents = toCents(this.floatText().trim() === '' ? '0' : this.floatText());
    if (cents === null) {
      this.snack.error('Escribe un fondo inicial válido.');
      return;
    }
    this.busy.set(true);
    this.cashSvc.open(centsToApi(cents)).subscribe({
      next: s => {
        this.busy.set(false);
        this.session.set(s);
        this.floatText.set('');
        this.snack.success('Caja abierta.');
      },
      error: err => {
        this.busy.set(false);
        if (err.error?.code === 'CASH_ALREADY_OPEN') this.reload();
        this.snack.error(err.error?.error ?? 'No se pudo abrir la caja.');
      },
    });
  }

  askClose(): void {
    if (toCents(this.countedText()) === null) {
      this.snack.error('Escribe cuánto efectivo hay en el cajón.');
      return;
    }
    this.confirmingClose.set(true);
  }

  close(): void {
    const counted = toCents(this.countedText());
    if (counted === null) return;
    this.busy.set(true);
    this.cashSvc.close(centsToApi(counted), this.notes()).subscribe({
      next: closed => {
        this.busy.set(false);
        this.confirmingClose.set(false);
        this.session.set(null);
        this.countedText.set('');
        this.notes.set('');
        this.viewing.set(closed);
        this.loadHistory(1);
      },
      error: err => {
        this.busy.set(false);
        this.confirmingClose.set(false);
        this.snack.error(err.error?.error ?? 'No se pudo cerrar la caja.');
      },
    });
  }

  view(s: CashSession): void {
    this.viewing.set(s);
  }

  dismiss(): void {
    this.viewing.set(null);
  }

  print(): void {
    printSheet();
  }

  /** 'ok' cuadra, 'short' faltante, 'over' sobrante: para colorear la diferencia. */
  toneOf(difference: string | null): 'ok' | 'short' | 'over' {
    const cents = toCents((difference ?? '').replace('-', '')) ?? 0;
    if (cents === 0) return 'ok';
    return (difference ?? '').startsWith('-') ? 'short' : 'over';
  }

  toneOfCents(cents: number): 'ok' | 'short' | 'over' {
    return cents === 0 ? 'ok' : cents < 0 ? 'short' : 'over';
  }

  signed(cents: number): string {
    return (cents > 0 ? '+' : '') + formatCents(cents);
  }

  go(delta: number): void {
    const next = this.page() + delta;
    if (next >= 1 && next <= this.pages()) this.loadHistory(next);
  }
}
