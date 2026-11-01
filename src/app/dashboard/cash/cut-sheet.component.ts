import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { CashSession } from '../../core/services/cash.service';
import { formatMoney, toCents } from '../pos/pos-math';

/**
 * Hoja del corte de caja. Se muestra en pantalla (turno cerrado o historial) y
 * se imprime en tamaño carta con los estilos globales de `.print-sheet`.
 */
@Component({
  selector: 'app-cut-sheet',
  imports: [DatePipe],
  template: `
    <article class="print-sheet print-wide cut">
      <header>
        <h2>Corte de caja</h2>
        <p>
          {{ session().opened_at | date: "dd/MM/yyyy HH:mm" }}
          @if (session().closed_at) { → {{ session().closed_at | date: "dd/MM/yyyy HH:mm" }} }
        </p>
        <p class="who">
          Abrió: {{ session().opened_by || '—' }}
          @if (session().status === 'closed') { · Cerró: {{ session().closed_by || '—' }} }
        </p>
      </header>

      <section>
        <h3>Ventas del turno</h3>
        <table>
          <thead><tr><th>Método</th><th class="n">Ventas</th><th class="n">Importe</th></tr></thead>
          <tbody>
            <tr><td>Efectivo</td><td class="n">{{ session().summary.cash.count }}</td><td class="n">{{ m(session().summary.cash.total) }}</td></tr>
            <tr><td>Tarjeta</td><td class="n">{{ session().summary.card.count }}</td><td class="n">{{ m(session().summary.card.total) }}</td></tr>
            <tr><td>Transferencia</td><td class="n">{{ session().summary.transfer.count }}</td><td class="n">{{ m(session().summary.transfer.total) }}</td></tr>
            @if (session().summary.other.count > 0) {
              <tr><td>Otros</td><td class="n">{{ session().summary.other.count }}</td><td class="n">{{ m(session().summary.other.total) }}</td></tr>
            }
          </tbody>
          <tfoot><tr><td>Total</td><td class="n">{{ session().summary.sales_count }}</td><td class="n">{{ m(session().summary.gross) }}</td></tr></tfoot>
        </table>
        <p class="note">
          Descuentos otorgados: {{ m(session().summary.discounts) }} ·
          Propinas: {{ m(session().summary.tips_total) }}
          @if (session().summary.excluded_count > 0) {
            · {{ session().summary.excluded_count }} venta(s) cancelada(s) fuera del corte
          }
        </p>
      </section>

      <section>
        <h3>Efectivo en caja</h3>
        <dl>
          <div><dt>Fondo inicial</dt><dd>{{ m(session().opening_float) }}</dd></div>
          <div><dt>+ Ventas en efectivo</dt><dd>{{ m(session().summary.cash.total) }}</dd></div>
          <div class="sum"><dt>Esperado</dt><dd>{{ m(session().expected_cash) }}</dd></div>
          @if (session().counted_cash !== null) {
            <div><dt>Contado</dt><dd>{{ m(session().counted_cash) }}</dd></div>
            <div class="diff" [class.short]="tone() === 'short'" [class.over]="tone() === 'over'">
              <dt>Diferencia</dt><dd>{{ differenceText() }}</dd>
            </div>
          }
        </dl>
        @if (session().notes) { <p class="note">Notas: {{ session().notes }}</p> }
      </section>
    </article>
  `,
  styles: [`
    :host { display: block; }
    .cut { background: #fff; color: #111; padding: 22px 24px; font-size: 13px; line-height: 1.5; }
    header { border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
    h2 { margin: 0 0 4px; font-size: 20px; }
    h3 { margin: 16px 0 6px; font-size: 13px; text-transform: uppercase; letter-spacing: .05em; color: #555; }
    p { margin: 0; }
    .who, .note { color: #555; font-size: 12px; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 5px 4px; border-bottom: 1px solid #ddd; text-align: left; }
    th { font-size: 11.5px; color: #555; font-weight: 600; }
    .n { text-align: right; font-variant-numeric: tabular-nums; }
    tfoot td { font-weight: 700; border-top: 2px solid #111; border-bottom: 0; }
    dl { margin: 0; }
    dl div { display: flex; justify-content: space-between; padding: 5px 0; border-bottom: 1px solid #eee; }
    dt, dd { margin: 0; }
    dd { font-variant-numeric: tabular-nums; }
    .sum { font-weight: 700; border-bottom: 2px solid #111 !important; }
    .diff { font-weight: 700; font-size: 15px; }
    .diff.short { color: #b91c1c; }
    .diff.over { color: #a16207; }
  `],
})
export class CutSheetComponent {
  session = input.required<CashSession>();

  m = formatMoney;

  tone = computed<'ok' | 'short' | 'over'>(() => {
    const d = toCents(String(this.session().difference ?? '').replace('-', '')) ?? 0;
    if (d === 0) return 'ok';
    return String(this.session().difference).startsWith('-') ? 'short' : 'over';
  });

  differenceText = computed(() => {
    const tone = this.tone();
    const amount = formatMoney(String(this.session().difference ?? '0').replace('-', ''));
    if (tone === 'ok') return `${amount} · Cuadra`;
    return tone === 'short' ? `-${amount} · Faltante` : `+${amount} · Sobrante`;
  });
}
