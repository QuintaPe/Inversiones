// Lectura y validación de lo que llega en las peticiones.
/** Precio positivo (admite coma decimal), o null. */
export const parsePrice = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** Fecha AAAA-MM-DD que existe. */
export const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
/**
 * Identificador de un activo: casi siempre un ISIN, pero las operaciones a mano admiten
 * cualquier texto corto (un inmueble, una cripto). Sin caracteres de control.
 */
export const isAssetId = (s) => typeof s === 'string' && s.length >= 1 && s.length <= 20 && s === s.trim() && !/[\x00-\x1f\x7f]/.test(s);

/** Error de validación: el middleware de errores lo devuelve como 400 con su mensaje. */
export class Invalid extends Error {}
/** Lanza Invalid si no se cumple la condición. */
export function check(cond, message) {
  if (!cond) throw new Invalid(message);
}
/** Las claves de un objeto { activo: valor } de una petición, con tope de tamaño. */
export function assetMap(obj, max, what) {
  check(obj && typeof obj === 'object' && !Array.isArray(obj), `Faltan ${what}.`);
  const entries = Object.entries(obj);
  check(entries.length <= max, `Demasiados ${what} en una sola petición.`);
  check(entries.every(([k]) => isAssetId(k)), 'Activo no válido.');
  return entries;
}
