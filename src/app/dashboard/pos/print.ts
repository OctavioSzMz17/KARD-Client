/**
 * Imprime solo la hoja marcada con `.print-sheet` (ticket, corte o etiquetas),
 * no la pantalla completa.
 *
 * La hoja se COPIA a una capa propia colgada de <body> y el resto de la página
 * se oculta al imprimir (ver `styles.scss`). Ocultar el resto con CSS y dejar
 * la hoja donde estaba la recortaba si vivía dentro de un diálogo con scroll;
 * la copia queda libre de cualquier contenedor.
 */
const ROOT_ID = 'print-root';
const BODY_CLASS = 'printing-sheet';

export function printSheet(selector = '.print-sheet'): void {
  const source = document.querySelector(selector);
  if (!source) return;

  cleanup();

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.appendChild(source.cloneNode(true));
  document.body.appendChild(root);
  document.body.classList.add(BODY_CLASS);

  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

function cleanup(): void {
  document.body.classList.remove(BODY_CLASS);
  document.getElementById(ROOT_ID)?.remove();
}
