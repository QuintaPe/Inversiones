// Categorías de gasto. Cada pago con tarjeta trae el código de categoría del comercio (MCC,
// norma ISO 18245 de las redes de tarjetas): de ahí sale la categoría automática. El usuario
// puede elegir otra para un comercio y se aplica a todos sus pagos.

/** [clave, nombre, tono (0–360) para su color] en el orden en que se ofrecen. */
export const CATS = [
  ['super', 'Supermercado', 145],
  ['food', 'Restaurantes y bares', 22],
  ['transport', 'Transporte', 205],
  ['fuel', 'Combustible', 40],
  ['shopping', 'Compras', 290],
  ['home', 'Hogar y suministros', 175],
  ['subs', 'Suscripciones', 250],
  ['leisure', 'Ocio y cultura', 320],
  ['travel', 'Viajes', 190],
  ['health', 'Salud', 355],
  ['sport', 'Deporte', 95],
  ['care', 'Cuidado personal', 335],
  ['edu', 'Educación', 55],
  ['cash', 'Cajero', 70],
  ['admin', 'Impuestos y administración', 10],
  ['fees', 'Comisiones', 0],
  ['transfer', 'Transferencias', 220],
  ['other', 'Otros', 230],
];
export const CAT = Object.fromEntries(CATS.map(([k, label, hue]) => [k, { key: k, label, hue }]));

const SETS = {
  super: [5297, 5298, 5300, 5411, 5412, 5422, 5441, 5451, 5462, 5499],
  food: [5811, 5812, 5813, 5814],
  transport: [4011, 4111, 4112, 4121, 4131, 4214, 4468, 4784, 4789, 5013, 5511, 5521, 5531, 5532, 5533, 5571, 5592, 5598, 5599,
    7511, 7523, 7524, 7531, 7534, 7535, 7538, 7542, 7549],
  fuel: [5172, 5541, 5542, 5552, 5983, 9752],
  subs: [4812, 4814, 4815, 4816, 4821, 4899, 5815, 5816, 5817, 5818, 5968, 7372, 7375],
  home: [742, 780, 1520, 1711, 1731, 1740, 1750, 1761, 1771, 1799, 4900, 5039, 5200, 5211, 5231, 5251, 5261, 5712, 5713, 5714,
    5718, 5719, 5722, 7210, 7211, 7216, 7217, 7342, 7349, 7622, 7623, 7629, 7631, 7641, 7692, 7699],
  health: [4119, 5047, 5122, 5912, 5975, 5976, 8011, 8021, 8031, 8041, 8042, 8043, 8049, 8050, 8062, 8071, 8099],
  leisure: [5733, 5735, 5942, 5994, 7800, 7801, 7802, 7829, 7832, 7841, 7911, 7922, 7929, 7932, 7933, 7991, 7992, 7993, 7994,
    7995, 7996, 7998, 7999],
  travel: [4411, 4511, 4582, 4722, 4723, 7011, 7012, 7032, 7033, 7512, 7513, 7519],
  sport: [5655, 5940, 5941, 7941, 7997],
  care: [5977, 7230, 7296, 7297, 7298],
  edu: [8211, 8220, 8241, 8244, 8249, 8299, 8351],
  cash: [6010, 6011],
  admin: [9211, 9222, 9223, 9311, 9399, 9402, 9405],
  other: [8398, 8641, 8651, 8661],
};
const BY_MCC = new Map(Object.entries(SETS).flatMap(([k, codes]) => codes.map((c) => [c, k])));

/** Categoría automática a partir del MCC. */
export function mccCategory(mcc) {
  const c = Number(mcc);
  if (!c) return 'other';
  if (BY_MCC.has(c)) return BY_MCC.get(c);
  if (c >= 3000 && c <= 3999) return 'travel'; // aerolíneas, alquiler de coches y hoteles con código propio
  if (c >= 5000 && c <= 5999) return 'shopping'; // el resto del comercio minorista
  return 'other';
}

/**
 * Categoría de un movimiento del extracto: [fecha, concepto, importe, nombre, mcc].
 * La que eligió el usuario para ese comercio manda sobre la automática.
 */
export function categoryOf(move, chosen = {}) {
  const [, group, , name = '', mcc = ''] = move;
  if (name && chosen[name]) return chosen[name];
  if (group === 'withdrawal') return 'transfer';
  return mccCategory(mcc); // sin MCC (datos de antes de guardarlo, comisiones): «Otros»
}

/** Nombre para mostrar: los que llegan en mayúsculas («LA TAGLIATELLA») pasan a «La Tagliatella». */
const SMALL = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e', 'en', 'a']);
export function prettyName(s = '') {
  if (!s || s !== s.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]{2}/.test(s)) return s;
  return s.toLowerCase().replace(/[\p{L}\d][^\s-]*/gu, (w, i) => (i > 0 && SMALL.has(w) ? w : w[0].toUpperCase() + w.slice(1)));
}

/** Lo que cuenta como gasto: pagos con tarjeta y lo que sale por transferencia o recibo. */
export const isSpend = (move) => (move[1] === 'card' || move[1] === 'withdrawal') && move[2] < 0;

/**
 * Pagos recurrentes (suscripciones, cuotas, recibos fijos): el mismo comercio cobra una vez al
 * mes, casi siempre lo mismo, al menos tres meses, y lo ha hecho en las últimas semanas.
 * Devuelve [{ name, amount, months, day, last, yearly }] de mayor a menor importe.
 */
export function recurring(moves, asOf) {
  const DAY = 86400000;
  const t = (d) => Date.parse(`${d}T00:00:00Z`);
  const from = new Date(t(asOf) - 400 * DAY).toISOString().slice(0, 10);
  const median = (xs) => { const v = [...xs].sort((a, b) => a - b); const k = v.length >> 1; return v.length % 2 ? v[k] : (v[k - 1] + v[k]) / 2; };
  const by = {};
  for (const m of moves) if (isSpend(m) && m[3] && m[0] >= from && m[0] <= asOf) (by[m[3]] ??= []).push(m);
  const out = [];
  for (const [name, ms] of Object.entries(by)) {
    const per = {};
    for (const m of ms) (per[m[0].slice(0, 7)] ??= []).push(m);
    const months = Object.keys(per).sort();
    if (months.length < 3) continue;
    // Una vez al mes: casi todos los meses con un solo cargo y casi sin meses saltados.
    if (months.filter((k) => per[k].length === 1).length / months.length < 0.75) continue;
    const idx = months.map((k) => +k.slice(0, 4) * 12 + +k.slice(5, 7));
    const gaps = idx.slice(1).map((v, i) => v - idx[i]);
    if (gaps.filter((g) => g === 1).length / gaps.length < 0.75) continue;
    // Casi siempre lo mismo (±10 %: una cuota o un recibo; el combustible o la compra varían más),
    // y activo: el último cargo hace menos de 45 días.
    const amounts = ms.map((m) => -m[2]);
    const amount = median(amounts);
    if (amounts.filter((a) => Math.abs(a - amount) <= Math.max(0.5, amount * 0.1)).length / amounts.length < 0.8) continue;
    const last = ms.map((m) => m[0]).sort().at(-1);
    if (t(asOf) - t(last) > 45 * DAY) continue;
    out.push({ name, amount, months: months.length, day: Math.round(median(ms.map((m) => +m[0].slice(8, 10)))), last, yearly: amount * 12 });
  }
  return out.sort((a, b) => b.amount - a.amount);
}
