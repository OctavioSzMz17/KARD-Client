/**
 * Pide una foto de Cloudinary al tamaño en que se muestra.
 *
 * Las fotos se guardan grandes (hasta 1600 px) y la tarjeta mide unos cientos.
 * Cloudinary las achica al vuelo si la dirección lleva la transformación:
 *   f_auto   el formato más ligero que acepte el navegador (AVIF o WebP)
 *   q_auto   la compresión más baja que no se nota
 *   c_limit  solo reduce, nunca agranda ni recorta (el recorte lo hace el CSS)
 *   w_N      el ancho en píxeles; se pide al doble del de pantalla para que se vea nítida
 *
 * Cualquier otra dirección (o una de Cloudinary que ya trae transformación) se devuelve igual.
 */
const CLOUDINARY_UPLOAD = /^(https:\/\/res\.cloudinary\.com\/[^/]+\/image\/upload\/)(v\d+\/.+)$/;

export function sizedImage(url: string | null | undefined, width: number): string {
  if (!url) return '';
  const m = CLOUDINARY_UPLOAD.exec(url);
  if (!m) return url;
  const w = Math.max(1, Math.round(width));
  return `${m[1]}f_auto,q_auto,c_limit,w_${w}/${m[2]}`;
}
