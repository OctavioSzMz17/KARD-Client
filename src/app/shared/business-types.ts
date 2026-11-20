/**
 * Los giros de negocio que ofrece la plataforma, en un solo lugar.
 *
 * Cada pantalla (registro, explorar, tienda, panel) necesitaba su propia lista
 * de nombres, frases e iconos, y sumar un giro significaba tocar diez archivos.
 * Aquí vive todo lo que cambia de un giro a otro; para agregar uno basta una
 * entrada nueva (y su valor en el back: `auth/models.py` y la migración 016).
 *
 * Los giros de comercio general (`grocery`, `bakery`, `clothing`, `stationery`,
 * `hardware`) comparten la misma ficha de producto: unidad, marca y categoría.
 * Restaurante y óptica tienen la suya.
 */

export type BusinessType =
  | 'restaurant' | 'optician'
  | 'grocery' | 'bakery' | 'clothing' | 'stationery' | 'hardware';

export interface BusinessTypeInfo {
  key: BusinessType;
  /** En singular: "Tiendita". Sale en el panel y en la tienda. */
  label: string;
  /** En plural: "Tienditas". Sale en las categorías de Explorar. */
  plural: string;
  /** Una línea para el tipo en el registro. */
  blurb: string;
  /** Frase de la tarjeta en Explorar, mientras el dueño no escriba la suya. */
  summary: string;
  /** Frase corta de la tienda, mientras el dueño no escriba la suya. */
  tagline: string;
  /** Párrafo de "Sobre nosotros", mientras el dueño no escriba el suyo. */
  about: string;
  /** Nombre por defecto de la tienda en Personalización: "Tu Tiendita". */
  storeName: string;
  /** Trazos del icono (viewBox 24, línea de 1.8). */
  icon: string[];
}

export const BUSINESS_TYPES: readonly BusinessTypeInfo[] = [
  {
    key: 'restaurant', label: 'Restaurante', plural: 'Restaurantes', storeName: 'Tu Restaurante',
    blurb: 'Comida y bebidas',
    summary: 'Platillos preparados al momento para ti.',
    tagline: 'Cocina hecha al momento, como en casa.',
    about: 'Preparamos cada platillo con ingredientes frescos y recetas cuidadas. Explora nuestro menú y ordena lo que se te antoje.',
    icon: ['M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2', 'M7 2v20', 'M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7'],
  },
  {
    key: 'grocery', label: 'Tiendita', plural: 'Tienditas', storeName: 'Tu Tiendita',
    blurb: 'Abarrotes y despensa',
    summary: 'Abarrotes y todo lo de la despensa.',
    tagline: 'Lo de todos los días, cerca de ti.',
    about: 'Tu tiendita de confianza: abarrotes, botanas, bebidas y lo que haga falta en casa. Explora el catálogo y haz tu pedido.',
    icon: ['m2 7 4.4-4.4A2 2 0 0 1 7.8 2h8.4a2 2 0 0 1 1.4.6L22 7', 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8',
           'M2 7h20v3a2 2 0 0 1-2 2 2.7 2.7 0 0 1-2-1 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-4 0 2.7 2.7 0 0 1-2 1 2 2 0 0 1-2-2Z'],
  },
  {
    key: 'bakery', label: 'Panadería', plural: 'Panaderías', storeName: 'Tu Panadería',
    blurb: 'Pan y repostería',
    summary: 'Pan, pasteles y repostería fresca.',
    tagline: 'Pan recién horneado, todos los días.',
    about: 'Horneamos pan, pasteles y repostería todos los días. Explora lo que hay hoy y reserva el tuyo antes de que se acabe.',
    icon: ['M4 12a4 4 0 0 1 2-7h12a4 4 0 0 1 2 7v6a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M9 9v3', 'M12 9v3', 'M15 9v3'],
  },
  {
    key: 'clothing', label: 'Ropa y accesorios', plural: 'Ropa y accesorios', storeName: 'Tu Tienda de Ropa',
    blurb: 'Moda y accesorios',
    summary: 'Ropa y accesorios para todos los días.',
    tagline: 'Tu estilo, a tu medida.',
    about: 'Ropa y accesorios para todos los días. Explora nuestro catálogo y encuentra lo que va contigo.',
    icon: ['M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z'],
  },
  {
    key: 'stationery', label: 'Papelería', plural: 'Papelerías', storeName: 'Tu Papelería',
    blurb: 'Útiles y oficina',
    summary: 'Útiles escolares y de oficina.',
    tagline: 'Todo para la escuela y la oficina.',
    about: 'Útiles escolares, material de oficina y todo lo que necesitas para crear. Explora el catálogo y haz tu pedido.',
    icon: ['M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z', 'm15 5 4 4'],
  },
  {
    key: 'hardware', label: 'Ferretería', plural: 'Ferreterías', storeName: 'Tu Ferretería',
    blurb: 'Herramientas y materiales',
    summary: 'Herramientas y materiales para tu obra.',
    tagline: 'Herramientas y materiales para tu obra.',
    about: 'Herramientas, tornillería, pinturas y materiales para tu proyecto. Explora el catálogo y encuentra lo que necesitas.',
    icon: ['M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z'],
  },
  {
    key: 'optician', label: 'Óptica', plural: 'Ópticas', storeName: 'Tu Óptica',
    blurb: 'Lentes y armazones',
    summary: 'Lentes, armazones y salud visual.',
    tagline: 'Cuidamos tu visión con atención personalizada.',
    about: 'Ofrecemos lentes, armazones y asesoría profesional para que veas mejor. Explora nuestro catálogo y encuentra lo que necesitas.',
    icon: ['M2 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M14 15a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M10 15h4',
           'M2.5 13 5 7c.7-1.3 1.4-2 3-2', 'M21.5 13 19 7c-.7-1.3-1.5-2-3-2'],
  },
];

const BY_KEY = new Map<string, BusinessTypeInfo>(BUSINESS_TYPES.map(t => [t.key, t]));

/** Lo de un giro, o `undefined` si no se conoce (por ejemplo `platform`). */
export function businessTypeInfo(type: string | null | undefined): BusinessTypeInfo | undefined {
  return type ? BY_KEY.get(type) : undefined;
}

/** Los giros que comparten la ficha de producto de comercio general. */
export function isGeneralCommerce(type: string | null | undefined): boolean {
  return !!type && type !== 'restaurant' && type !== 'optician' && BY_KEY.has(type);
}

/** Unidades de venta de la ficha de comercio general. Deben coincidir con `GENERAL_UNITS` del back. */
export const GENERAL_UNITS = ['pieza', 'kg', 'g', 'litro', 'ml', 'paquete', 'caja', 'docena'] as const;

/** Lo que se captura de un producto de comercio general. Todo es opcional. */
export interface GeneralFields {
  unidad?: string | null;
  marca?: string | null;
  categoria_general?: string | null;
}

/** Arma la ficha (`metadata`) de comercio general; lo vacío no se manda, el servidor lo rechazaría. */
export function generalMetadata(f: GeneralFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (f.unidad) out['unidad'] = f.unidad;
  const marca = (f.marca ?? '').trim();
  if (marca) out['marca'] = marca;
  const categoria = (f.categoria_general ?? '').trim();
  if (categoria) out['categoria'] = categoria;
  return out;
}
