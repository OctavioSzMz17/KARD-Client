/**
 * Imágenes de la pantalla de acceso.
 *
 * Son fotos de prueba de Unsplash, que permite enlazarlas directo (su licencia
 * es libre). Para cambiar una basta reemplazar su URL o id aquí: la pantalla
 * no vuelve a tocarse. Si una imagen no carga, el fondo oscuro de cada panel
 * ya se ve bien por sí solo.
 *
 * Cuando haya subida de imágenes propias, esto es lo único que debería
 * apuntar a otro origen.
 */

const unsplash = (id: string, width: number) =>
  `https://images.unsplash.com/photo-${id}?w=${width}&q=70&auto=format&fit=crop`;

/** Lado Cliente: alguien de compras. */
export const CLIENT_PHOTO = unsplash('1483985988355-763728e1935b', 1600);

/** Lado Negocio: una dueña atendiendo en su mostrador. */
export const BUSINESS_PHOTO = unsplash('1556740758-90de374c12ad', 1600);

/**
 * Una burbuja flotante del lado oscuro del modo Cliente: lo que un cliente
 * encontrará en la plataforma. Hoy existen dos giros (restaurante y óptica);
 * al sumar otro, se agrega aquí con su foto.
 *
 * Las posiciones (`x`, `y`) son el centro, en % de la pantalla; `xm`/`ym` son
 * las del celular. `depth` es cuánto se mueve con el cursor: más grande, más
 * cerca de quien mira.
 */
export interface Bubble {
  img: string;
  size: number;
  x: string;  y: string;
  xm: string; ym: string;
  /** Se muestra también en el celular, donde sobra poco espacio. */
  mobile?: boolean;
  depth: number;
  /** Segundos que tarda un ciclo de flotación, y su desfase para que no vayan al unísono. */
  dur: number;
  delay: number;
  label?: string;
}

export const BUBBLES: Bubble[] = [
  { img: unsplash('1555396273-367ea4eb4db5', 360), size: 150, x: '82%', y: '22%', xm: '82%', ym: '88%', mobile: true,  depth: 22, dur: 7.5, delay: 0,    label: 'Restaurantes' },
  { img: unsplash('1414235077428-338989a2e8c0', 300), size: 84,  x: '69%', y: '12%', xm: '16%', ym: '92%', mobile: true,  depth: 12, dur: 6.2, delay: -2 },
  { img: unsplash('1565958011703-44f9829ba187', 160), size: 64,  x: '96%', y: '10%', xm: '50%', ym: '95%', depth: 8,  dur: 5.6, delay: -3 },
  { img: unsplash('1565299624946-b28f40a0ae38', 300), size: 96,  x: '91%', y: '46%', xm: '90%', ym: '70%', depth: 16, dur: 6.8, delay: -1 },
  { img: unsplash('1540189549336-e6e99c3679fe', 260), size: 70,  x: '74%', y: '37%', xm: '10%', ym: '74%', depth: 10, dur: 5.9, delay: -4 },
  { img: unsplash('1591076482161-42ce6da69f67', 360), size: 140, x: '78%', y: '68%', xm: '40%', ym: '84%', depth: 26, dur: 8.2, delay: -2.5, label: 'Ópticas' },
  { img: unsplash('1482049016688-2d3e1b311543', 240), size: 72,  x: '66%', y: '48%', xm: '70%', ym: '66%', depth: 14, dur: 6.4, delay: -5 },
  { img: unsplash('1550547660-d9450f859349', 300),    size: 104, x: '70%', y: '86%', xm: '24%', ym: '64%', depth: 18, dur: 7.1, delay: -1.5 },
  { img: unsplash('1577803645773-f96470509666', 240), size: 78,  x: '92%', y: '80%', xm: '78%', ym: '92%', depth: 20, dur: 6.0, delay: -3.5 },
];
