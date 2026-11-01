import { Component, computed, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { PosSale } from '../../core/services/sales.service';
import { formatMoney, toCents } from './pos-math';

const PAYMENT_LABEL: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer: 'Transferencia',
  online: 'En línea',
};

const FULFILLMENT_LABEL: Record<string, string> = {
  dine_in: 'Mesa',
  takeaway: 'Para llevar',
  pickup: 'Recoger',
  delivery: 'Envío',
};

/**
 * Ticket de venta. Se ve igual en pantalla y en papel de 80 mm; al imprimir,
 * los estilos globales (`.print-sheet`) dejan solo esta hoja en la página.
 */
@Component({
  selector: 'app-receipt',
  imports: [DatePipe],
  template: `
    <article class="print-sheet receipt">
      <header class="r-head">
        <h2>{{ sale().business_name }}</h2>
        <p>Ticket {{ folio() }}</p>
        <p>{{ sale().created_at | date: "dd/MM/yyyy HH:mm" }}</p>
      </header>

      <div class="r-meta">
        <span>{{ fulfillment() }}</span>
        @if (sale().customer_name) { <span>Cliente: {{ sale().customer_name }}</span> }
        @if (sale().cashier) { <span>Atendió: {{ sale().cashier }}</span> }
      </div>

      <table class="r-items">
        <tbody>
          @for (it of sale().items; track it.product_id) {
            <tr>
              <td class="q">{{ it.quantity }}×</td>
              <td class="n">{{ it.product_name }}<small>{{ money(it.unit_price) }} c/u</small></td>
              <td class="t">{{ money(it.subtotal) }}</td>
            </tr>
          }
        </tbody>
      </table>

      <dl class="r-totals">
        <div><dt>Subtotal</dt><dd>{{ money(sale().subtotal) }}</dd></div>
        @if (hasDiscount()) {
          <div><dt>Descuento</dt><dd>-{{ money(sale().discount_amount) }}</dd></div>
        }
        @if (hasTip()) {
          <div><dt>Propina</dt><dd>{{ money(sale().tip_amount) }}</dd></div>
        }
        <div class="grand"><dt>Total</dt><dd>{{ money(sale().total) }}</dd></div>
        <div><dt>Pago</dt><dd>{{ payment() }}</dd></div>
        @if (sale().amount_received !== null) {
          <div><dt>Recibido</dt><dd>{{ money(sale().amount_received) }}</dd></div>
          <div><dt>Cambio</dt><dd>{{ money(sale().change_given) }}</dd></div>
        }
      </dl>

      <footer class="r-foot">¡Gracias por su compra!</footer>
    </article>
  `,
  styles: [`
    :host { display: block; }
    .receipt {
      width: 100%;
      max-width: 320px;
      margin: 0 auto;
      padding: 18px 16px;
      background: #fff;
      color: #111;
      font-family: 'Courier New', ui-monospace, monospace;
      font-size: 12.5px;
      line-height: 1.45;
    }
    .r-head { text-align: center; border-bottom: 1px dashed #999; padding-bottom: 10px; }
    .r-head h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
    .r-head p { margin: 0; }
    .r-meta { display: flex; flex-direction: column; padding: 8px 0; border-bottom: 1px dashed #999; }
    .r-items { width: 100%; border-collapse: collapse; margin: 8px 0; }
    .r-items td { padding: 3px 0; vertical-align: top; }
    .r-items .q { width: 30px; white-space: nowrap; }
    .r-items .t { text-align: right; white-space: nowrap; padding-left: 8px; }
    .r-items small { display: block; color: #666; font-size: 11px; }
    .r-totals { border-top: 1px dashed #999; padding-top: 8px; margin: 0; }
    .r-totals div { display: flex; justify-content: space-between; }
    .r-totals dt, .r-totals dd { margin: 0; }
    .r-totals .grand { font-size: 15px; font-weight: 700; padding: 4px 0; }
    .r-foot { text-align: center; margin-top: 14px; padding-top: 10px; border-top: 1px dashed #999; }
  `],
})
export class ReceiptComponent {
  sale = input.required<PosSale>();

  money = formatMoney;

  /** Folio corto y legible: los últimos caracteres del id. */
  folio = computed(() => '#' + this.sale().order_id.slice(-8).toUpperCase());

  payment = computed(() => PAYMENT_LABEL[this.sale().payment_method ?? ''] ?? '—');

  fulfillment = computed(() => {
    const s = this.sale();
    const base = FULFILLMENT_LABEL[s.fulfillment_type] ?? s.fulfillment_type;
    return s.table_number ? `${base} ${s.table_number}` : base;
  });

  hasDiscount = computed(() => (toCents(this.sale().discount_amount) ?? 0) > 0);
  hasTip = computed(() => (toCents(this.sale().tip_amount) ?? 0) > 0);
}
