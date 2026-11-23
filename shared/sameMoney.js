// Comparación con tu dinero para la ficha de un activo. Va aparte de calc.js para que solo
// la descargue la ficha (calc.js está en la carga inicial).

/**
 * Lo que hiciste con un valor frente a haber hecho lo mismo con el dinero en un índice: cada
 * compra mete esos mismos euros en el índice (al cierre anterior, como entra en tu cartera) y
 * cada venta o dividendo saca los mismos euros (al cierre del día). Si al empezar la serie ya
 * tenías el valor, el índice empieza con lo que valía.
 *
 * @param evs     eventos de la posición (p.evs): compras, ventas, dividendos y splits
 * @param dates   fechas de la serie del valor
 * @param closes  cierres del valor en euros, ajustados por splits (el último puede ser el precio de hoy)
 * @param ix      cierres del índice en las mismas fechas (null donde aún no hay)
 * @returns {{ me: (number | null)[], ix: (number | null)[], cap: number } | null} resultado acumulado
 *          en euros día a día (null antes de que haya índice) y el capital con que se compara (lo que
 *          ya había más compras menos ventas y dividendos, como en el resumen): la base del porcentaje.
 */
export function sameMoney(evs, dates, closes, ix) {
  const s = ix.findIndex((v) => v > 0);
  if (s < 0) return null;
  // Los cierres vienen ajustados por los splits posteriores: las acciones de entonces se pasan a esa escala.
  const splits = evs.filter((e) => e.k === 'X');
  const adj = (d) => splits.reduce((k, e) => (e.d > d ? k * e.ratio : k), 1);
  const pos = evs.filter((e) => e.sa != null);
  let pi = 0, held = 0;
  const shares = (d) => {
    while (pi < pos.length && pos[pi].d <= d) held = pos[pi++].sa;
    return held * adj(d);
  };
  const flows = evs.filter((e) => e.k === 'B' || e.k === 'S' || e.k === 'D');
  let k = 0;
  while (k < flows.length && flows[k].d <= dates[s]) k++; // ya están en el valor del primer día
  const v0 = shares(dates[s]) * closes[s];
  let units = v0 / ix[s], put = 0, cap = v0;
  const me = [], out = [];
  let last = ix[s];
  for (let i = 0; i < dates.length; i++) {
    if (i < s) { me.push(null); out.push(null); continue; }
    const c = ix[i] ?? last;
    if (i > s) {
      let inn = 0, gone = 0;
      while (k < flows.length && flows[k].d <= dates[i]) { const f = flows[k++]; if (f.k === 'B') inn += f.net; else gone += f.net; }
      units += inn / last - gone / c;
      put += inn - gone;
      cap += inn - gone;
    }
    me.push(shares(dates[i]) * closes[i] - v0 - put);
    out.push(units * c - v0 - put);
    last = c;
  }
  return { me, ix: out, cap };
}
