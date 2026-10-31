/**
 * Imágenes de la identidad visual de KARD (pantalla de acceso y catálogo de negocios).
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
 * Las burbujas flotan a la deriva dentro de una caja invisible (rebotan con
 * sus paredes y entre ellas), así que aquí solo se describe su aspecto: el
 * tamaño en px y qué tanto la empuja el cursor (`depth`, más grande = más
 * cerca de quien mira). Su posición y rumbo los decide la simulación.
 */
export interface Bubble {
  img: string;
  size: number;
  depth: number;
  /** Se muestra también en el celular, donde sobra poco espacio. */
  mobile?: boolean;
  label?: string;
}

export const BUBBLES: Bubble[] = [
  { img: unsplash('1555396273-367ea4eb4db5', 360), size: 150, depth: 22, mobile: true, label: 'Restaurantes' },
  { img: unsplash('1414235077428-338989a2e8c0', 300), size: 84,  depth: 12, mobile: true },
  { img: unsplash('1565958011703-44f9829ba187', 160), size: 64,  depth: 8 },
  { img: unsplash('1565299624946-b28f40a0ae38', 300), size: 96,  depth: 16 },
  { img: unsplash('1540189549336-e6e99c3679fe', 260), size: 70,  depth: 10 },
  { img: unsplash('1591076482161-42ce6da69f67', 360), size: 140, depth: 26, mobile: true, label: 'Ópticas' },
  { img: unsplash('1482049016688-2d3e1b311543', 240), size: 72,  depth: 14 },
  { img: unsplash('1550547660-d9450f859349', 300),    size: 104, depth: 18 },
  { img: unsplash('1577803645773-f96470509666', 240), size: 78,  depth: 20 },
];
