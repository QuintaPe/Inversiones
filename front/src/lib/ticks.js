// Marcas del eje de fechas de las gráficas: años en tramos largos, meses en los medios y días
// en los cortos, siempre en pasos «redondos» para que no se lean como fechas arbitrarias.

const DAY = 86400000;
const MONTH_STEPS = [1, 2, 3, 6];
const fmt = (opts) => (t) => new Date(t).toLocaleDateString('es-ES', { ...opts, timeZone: 'UTC' });
const asYear = fmt({ year: 'numeric' });
const asMonth = fmt({ month: 'short', year: '2-digit' });
const asDay = fmt({ day: 'numeric', month: 'short' });

/**
 * @param t0, t1  extremos del eje (ms, UTC)
 * @param width   ancho disponible en píxeles
 * @param room    píxeles que necesita cada rótulo
 * @returns [{ t, s }] marcas dentro de (t0, t1), con su rótulo
 */
export function timeTicks(t0, t1, width, room = 80) {
  if (!(t1 > t0) || !(width > 0)) return [];
  const max = Math.max(2, Math.floor(width / room));
  const a = new Date(t0), b = new Date(t1);
  const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  const out = [];
  const push = (t, label) => { if (t > t0 && t < t1) out.push({ t, s: label(t) }); };

  // Meses: mientras quepan en pasos de hasta medio año.
  const step = MONTH_STEPS.find((s) => months / s <= max);
  if (months >= 2 && step) {
    // Alineadas con el año (ene, abr, jul, oct…), no con el mes en que empieza la serie.
    const first = Math.ceil((a.getUTCMonth() + 1) / step) * step;
    for (let m = first; ; m += step) {
      const t = Date.UTC(a.getUTCFullYear(), m, 1);
      if (t >= t1) break;
      push(t, asMonth);
    }
    if (out.length) return out;
  }
  // Años: el 1 de enero, cada 1, 2, 5, 10… años.
  if (months >= 2) {
    const years = months / 12;
    const every = [1, 2, 5, 10, 20, 50].find((s) => years / s <= max) ?? 100;
    const first = Math.ceil((a.getUTCFullYear() + 1) / every) * every;
    for (let y = first; ; y += every) {
      const t = Date.UTC(y, 0, 1);
      if (t >= t1) break;
      push(t, asYear);
    }
    if (out.length) return out;
  }
  // Tramos cortos: días repartidos por igual.
  const n = Math.min(max, Math.max(2, Math.floor((t1 - t0) / DAY)));
  for (let k = 1; k < n; k++) push(t0 + ((t1 - t0) * k) / n, asDay);
  return out;
}
