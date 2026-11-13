// Lectura y validación de lo que llega en las peticiones.
/** Precio positivo (admite coma decimal), o null. */
export const parsePrice = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
};
/** Fecha AAAA-MM-DD que existe. */
export const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
