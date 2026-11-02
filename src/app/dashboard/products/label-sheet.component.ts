import { Component, effect, inject, input, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { formatMoney } from '../pos/pos-math';
import { LabelMode, Labelable, barcodeSvg, labelCode, qrSvg } from './labels';

/** Una etiqueta por imprimir: el producto y qué lleva (QR, barras o ambos). */
export interface LabelItem {
  product: Labelable & { name: string; price: string };
  mode: LabelMode;
}

interface RenderedLabel {
  id: string;
  name: string;
  price: string;
  code: string;
  mode: LabelMode;
  qr: SafeHtml | null;
  barcode: SafeHtml | null;
}

/**
 * Hoja de etiquetas: una cuadrícula de tres columnas pensada para papel carta
 * o A4 (con guías punteadas para recortar). Sirve igual para la vista previa
 * en pantalla y para imprimir; al imprimir, los estilos globales de
 * `.print-sheet` dejan solo esta hoja.
 *
 * Los SVG los genera la librería a partir del código del producto (validado
 * en el alta: solo letras, números y . _ / -), no llevan texto libre, así que
 * es seguro mostrarlos como HTML.
 */
@Component({
  selector: 'app-label-sheet',
  template: `
    <section class="print-sheet print-wide labels" aria-label="Etiquetas">
      @for (l of rendered(); track l.id) {
        <figure class="label" [class.label-both]="l.mode === 'both'">
          <figcaption>
            <span class="l-name">{{ l.name }}</span>
            <span class="l-price">{{ l.price }}</span>
          </figcaption>

          <div class="l-codes">
            @if (l.qr) { <div class="l-qr" [innerHTML]="l.qr" role="img" [attr.aria-label]="'QR de ' + l.name"></div> }
            @if (l.barcode) { <div class="l-bars" [innerHTML]="l.barcode" role="img" [attr.aria-label]="'Código de barras de ' + l.name"></div> }
          </div>

          <span class="l-code">{{ l.code }}</span>
        </figure>
      }
    </section>
  `,
  styles: [`
    :host { display: block; }

    .labels {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 4mm;
      padding: 6mm;
      background: #fff;
      color: #111;
      font-family: 'Inter', system-ui, sans-serif;
    }

    .label {
      display: flex;
      flex-direction: column;
      gap: 2mm;
      margin: 0;
      padding: 3mm;
      border: 1px dashed #aaa;
      border-radius: 2mm;
      break-inside: avoid;
      page-break-inside: avoid;
      min-width: 0;
    }

    figcaption {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 2mm;
      min-width: 0;
    }

    .l-name {
      flex: 1;
      min-width: 0;
      font-size: 9pt;
      font-weight: 700;
      line-height: 1.2;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .l-price { font-size: 9pt; font-weight: 700; white-space: nowrap; }

    .l-codes {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 3mm;
    }

    // Solo QR: cuadrado y centrado.
    .l-qr { width: 26mm; height: 26mm; flex-shrink: 0; }

    // Solo barras: ancho completo y bajo.
    .l-bars { flex: 1; min-width: 0; height: 13mm; }

    // Ambos: QR chico a un lado y barras al otro.
    .label-both .l-qr { width: 20mm; height: 20mm; }
    .label-both .l-bars { height: 20mm; }

    // El SVG entra como HTML inyectado: no lleva el atributo de estilos del componente.
    .l-qr ::ng-deep svg, .l-bars ::ng-deep svg { display: block; width: 100%; height: 100%; }

    .l-code {
      text-align: center;
      font-family: ui-monospace, 'Courier New', monospace;
      font-size: 8pt;
      letter-spacing: 0.04em;
      word-break: break-all;
    }

    @media (max-width: 640px) {
      .labels { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 3mm; padding: 3mm; }
    }

    @media print {
      .labels { grid-template-columns: repeat(3, 1fr); gap: 4mm; padding: 0; }
    }
  `],
})
export class LabelSheetComponent {
  private sanitizer = inject(DomSanitizer);

  items = input.required<LabelItem[]>();

  protected rendered = signal<RenderedLabel[]>([]);

  constructor() {
    // Los QR se generan de forma asíncrona: se rehace la lista cuando cambian los elementos.
    effect(() => {
      const list = this.items();
      void this.render(list);
    });
  }

  private async render(list: LabelItem[]): Promise<void> {
    const out = await Promise.all(
      list.map(async ({ product, mode }): Promise<RenderedLabel> => {
        const code = labelCode(product);
        const wantsQr = mode === 'qr' || mode === 'both';
        const wantsBars = mode === 'barcode' || mode === 'both';
        const qr = wantsQr ? await qrSvg(code) : null;
        return {
          id: `${product.product_id}-${mode}`,
          name: product.name,
          price: formatMoney(product.price),
          code,
          mode,
          qr: qr ? this.sanitizer.bypassSecurityTrustHtml(qr) : null,
          barcode: wantsBars ? this.sanitizer.bypassSecurityTrustHtml(barcodeSvg(code)) : null,
        };
      }),
    );
    this.rendered.set(out);
  }
}
