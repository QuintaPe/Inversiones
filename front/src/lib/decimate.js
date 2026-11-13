/**
 * Índices que hace falta dibujar: por cada columna de píxel, el primero, el mínimo, el
 * máximo y el último. La línea se ve igual que con todos los puntos, pero un histórico
 * de años (miles de días) queda en unos pocos cientos. Los huecos (null) se conservan.
 * @param n    cuántos valores hay
 * @param val  (i) => valor o null
 * @param px   (i) => posición x en píxeles
 */
export function decimate(n, val, px) {
  const out = [];
  let col = NaN, first = -1, lo = -1, hi = -1, last = -1;
  const flush = () => {
    if (first < 0) return;
    for (const k of [first, lo, hi, last].sort((a, b) => a - b)) if (out.at(-1) !== k) out.push(k);
    first = -1;
  };
  for (let i = 0; i < n; i++) {
    const v = val(i);
    if (v == null) { flush(); out.push(i); col = NaN; continue; }
    const c = Math.round(px(i));
    if (c !== col) { flush(); col = c; first = lo = hi = i; }
    if (v < val(lo)) lo = i;
    if (v > val(hi)) hi = i;
    last = i;
  }
  flush();
  return out;
}
