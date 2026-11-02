import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';

/** Qué lleva la etiqueta de un producto. */
export type LabelMode = 'qr' | 'barcode' | 'both';

export const LABEL_MODES: { key: LabelMode; label: string }[] = [
  { key: 'qr', label: 'QR' },
  { key: 'barcode', label: 'Barras' },
  { key: 'both', label: 'Ambos' },
];

/** Lo mínimo que se necesita de un producto para etiquetarlo. */
export interface Labelable {
  product_id: string;
  sku: string | null;
  barcode: string | null;
}

/**
 * El valor que lleva la etiqueta, en este orden: código de barras, SKU y, si
 * el producto no tiene ninguno, su id. Es el mismo orden con el que el
 * servidor resuelve lo que lee el escáner (`GET /products/lookup`), así que
 * lo impreso siempre se puede volver a encontrar.
 */
export function labelCode(p: Labelable): string {
  return p.barcode || p.sku || p.product_id;
}

/** El producto no tiene código propio y su etiqueta usa el id. */
export function usesFallbackId(p: Labelable): boolean {
  return !p.barcode && !p.sku;
}

const qrCache = new Map<string, string>();

/**
 * QR del valor, como SVG (vectorial: sale nítido a cualquier tamaño al
 * imprimir). El SVG lo genera la librería a partir de un valor ya validado,
 * no contiene texto de usuario.
 */
export async function qrSvg(value: string): Promise<string> {
  const hit = qrCache.get(value);
  if (hit) return hit;
  const svg = await QRCode.toString(value, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  qrCache.set(value, svg);
  return svg;
}

const barcodeCache = new Map<string, string>();

/**
 * Código de barras Code 128 del valor, como SVG.
 *
 * Code 128 y no EAN-13: acepta letras, números y símbolos (un SKU como
 * "TAC-01" no cabe en un EAN) y no exige dígito verificador. Un EAN real
 * impreso en Code 128 se lee igual: el escáner entrega los mismos dígitos.
 */
export function barcodeSvg(value: string): string {
  const hit = barcodeCache.get(value);
  if (hit) return hit;

  const node = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(node, value, {
    format: 'CODE128',
    displayValue: false,   // el valor se imprime aparte, con la tipografía de la etiqueta
    margin: 0,
    width: 2,
    height: 60,
  });
  // Escala con el contenedor en vez de quedarse en píxeles fijos: hace falta
  // un viewBox con las medidas originales antes de quitar width y height.
  if (!node.getAttribute('viewBox')) {
    const w = parseFloat(node.getAttribute('width') ?? '0');
    const h = parseFloat(node.getAttribute('height') ?? '0');
    if (w > 0 && h > 0) node.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  node.removeAttribute('width');
  node.removeAttribute('height');
  node.setAttribute('preserveAspectRatio', 'none');
  node.style.removeProperty('width');
  node.style.removeProperty('height');

  const svg = node.outerHTML;
  barcodeCache.set(value, svg);
  return svg;
}
