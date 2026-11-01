/**
 * Imprime solo la hoja marcada con `.print-sheet` (ticket o corte), no la
 * pantalla completa. Los estilos de impresión viven en `styles.scss` y se
 * activan con esta clase en <body>, que se quita al terminar el diálogo.
 */
export function printSheet(): void {
  const cls = 'printing-sheet';
  const done = () => {
    document.body.classList.remove(cls);
    window.removeEventListener('afterprint', done);
  };
  document.body.classList.add(cls);
  window.addEventListener('afterprint', done);
  window.print();
}
