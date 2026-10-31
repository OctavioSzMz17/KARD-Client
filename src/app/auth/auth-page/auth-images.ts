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
 * Una burbuja del lado oscuro del modo Cliente: lo que un cliente encontrará
 * en la plataforma. Hoy existen dos giros (restaurante y óptica); al sumar
 * otro, se agrega aquí con su foto.
 *
 * Las burbujas emergen desde abajo y suben meciéndose, y reaparecen: `x` es su
 * columna (centro, en % del ancho; `xm` en el celular), `rise` los segundos que
 * tarda en cruzar la pantalla y `delay` (negativo) en qué punto del recorrido
 * está al abrir la página, para que no salgan todas juntas. `sway` es cuánto se
 * mece de lado y `depth` cuánto la empuja el cursor (más grande, más cerca).
 */
export interface Bubble {
  img: string;
  size: number;
  x: string;
  xm: string;
  /** Altura fija de reposo, solo para quien pide menos movimiento. */
  y: string;
  /** Se muestra también en el celular, donde sobra poco espacio. */
  mobile?: boolean;
  rise: number;
  delay: number;
  sway: number;
  depth: number;
  label?: string;
}

export const BUBBLES: Bubble[] = [
  { img: unsplash('1555396273-367ea4eb4db5', 360), size: 150, x: '83%', xm: '78%', y: '22%', mobile: true, rise: 26, delay: -2,  sway: 22, depth: 22, label: 'Restaurantes' },
  { img: unsplash('1414235077428-338989a2e8c0', 300), size: 84,  x: '69%', xm: '16%', y: '12%', mobile: true, rise: 20, delay: -14, sway: 16, depth: 12 },
  { img: unsplash('1565958011703-44f9829ba187', 160), size: 64,  x: '96%', xm: '50%', y: '10%',               rise: 18, delay: -6,  sway: 12, depth: 8 },
  { img: unsplash('1565299624946-b28f40a0ae38', 300), size: 96,  x: '90%', xm: '90%', y: '46%',               rise: 22, delay: -19, sway: 18, depth: 16 },
  { img: unsplash('1540189549336-e6e99c3679fe', 260), size: 70,  x: '75%', xm: '10%', y: '37%',               rise: 19, delay: -9,  sway: 14, depth: 10 },
  { img: unsplash('1591076482161-42ce6da69f67', 360), size: 140, x: '79%', xm: '46%', y: '68%', mobile: true, rise: 28, delay: -21, sway: 24, depth: 26, label: 'Ópticas' },
  { img: unsplash('1482049016688-2d3e1b311543', 240), size: 72,  x: '66%', xm: '70%', y: '48%',               rise: 17, delay: -12, sway: 14, depth: 14 },
  { img: unsplash('1550547660-d9450f859349', 300),    size: 104, x: '86%', xm: '24%', y: '86%',               rise: 24, delay: -5,  sway: 20, depth: 18 },
  { img: unsplash('1577803645773-f96470509666', 240), size: 78,  x: '72%', xm: '78%', y: '80%',               rise: 21, delay: -16, sway: 16, depth: 20 },
];
