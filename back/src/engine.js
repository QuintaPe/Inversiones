// Motor de cálculo: convierte las filas del CSV de Trade Republic en posiciones
// con coste medio ponderado. Cada evento guarda los pasos intermedios para que
// el front pueda enseñar de dónde sale cada cifra.

import { parse } from 'csv-parse/sync';

export const REQUIRED_COLUMNS = [
  'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description', 'transaction_id',
];

// Solo estas filas afectan a la cartera; el resto (tarjeta, transferencias,
// intereses…) no se guarda.
const RELEVANT_TYPES = new Set([
  'BUY', 'SELL', 'DIVIDEND', 'PRIVATE_MARKET_BUY', 'IPO_SUBSCRIPTION',
  'BONUS', 'MANUAL', 'BENEFITS_SAVEBACK',
]);

const EPS = 1e-9;
const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
const abs = (v) => Math.abs(num(v));
const shortId = (id) => String(id).slice(-8);
const fmtDate = (d) => d.split('-').reverse().join('/');
const fmtEur = (n) =>
  n.toLocaleString('es-ES', { maximumFractionDigits: 2, useGrouping: 'always' });

export class CsvError extends Error {}

/** Parsea el CSV y devuelve solo las filas relevantes, con las columnas necesarias. */
export function parseCsv(text) {
  let records;
  try {
    records = parse(text, { columns: true, bom: true, skip_empty_lines: true, relax_column_count: true });
  } catch (err) {
    throw new CsvError(`No se pudo leer el CSV: ${err.message}`);
  }
  if (!records.length) throw new CsvError('El CSV está vacío.');
  const missing = REQUIRED_COLUMNS.filter((c) => !(c in records[0]));
  if (missing.length) {
    throw new CsvError(
      `No parece una exportación de transacciones de Trade Republic. Faltan columnas: ${missing.join(', ')}.`,
    );
  }
  const rows = records
    .filter((r) => r.transaction_id && RELEVANT_TYPES.has(r.type))
    .map((r) => {
      const row = {};
      for (const c of REQUIRED_COLUMNS) row[c] = r[c] ?? '';
      for (const c of ['original_amount', 'original_currency', 'fx_rate']) row[c] = r[c] ?? '';
      return row;
    });
  return { total: records.length, rows };
}

const byTime = (a, b) => {
  const d = Date.parse(a.datetime) - Date.parse(b.datetime);
  return d || (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0);
};

/** Id de orden citado en la descripción ("… for buy order: <uuid>"). */
const orderId = (desc) => (desc.match(/for buy order:\s*([0-9a-f-]{36})/i) || [])[1];

export function buildPortfolio(rows) {
  const sorted = [...rows].sort(byTime);
  const trades = sorted.filter((r) => r.category === 'TRADING' && (r.type === 'BUY' || r.type === 'SELL'));
  const dividends = sorted.filter((r) => r.type === 'DIVIDEND');

  // Private Markets: pre-pagos pendientes de casar con su compra, y cuáles se pagaron con bonus.
  const prepays = sorted
    .filter((r) => r.type === 'PRIVATE_MARKET_BUY')
    .map((r) => ({ row: r, order: orderId(r.description), used: false }));
  const bonusOrders = new Set();
  const bonusDates = {};
  for (const r of sorted.filter((x) => x.type === 'BONUS')) {
    const m = r.description.match(/bonus\s+([0-9a-f-]{36})/i);
    if (m) { bonusOrders.add(m[1]); bonusDates[m[1]] = r.date; }
  }
  // Compras financiadas con Saveback: su "tax" es la retención del premio, no coste de compra.
  const savebacks = sorted.filter((r) => r.type === 'BENEFITS_SAVEBACK' && r.symbol);
  const isSaveback = (r) =>
    savebacks.some((s) => s.symbol === r.symbol && s.date === r.date && Math.abs(abs(s.amount) - abs(r.amount)) < 0.005);
  const ipoRows = sorted.filter((r) => r.type === 'IPO_SUBSCRIPTION');
  const manualTax = sorted.filter((r) => r.type === 'MANUAL' && abs(r.tax) > 0);

  const map = new Map();
  const get = (r) => {
    if (!map.has(r.symbol)) {
      map.set(r.symbol, {
        isin: r.symbol, name: r.name, cls: r.asset_class,
        grp: r.asset_class === 'PRIVATE_FUND' ? 'pm' : 'ac',
        sh: 0, cost: 0, evs: [], lots: [],
      });
    }
    const p = map.get(r.symbol);
    if (r.name) p.name = r.name;
    return p;
  };

  const events = [...trades, ...dividends].sort(byTime);
  for (const r of events) {
    if (!r.symbol) continue;
    const p = get(r);
    const ev = { id: shortId(r.transaction_id), d: r.date };

    if (r.type === 'DIVIDEND') {
      const g = abs(r.amount), tax = abs(r.tax);
      Object.assign(ev, {
        k: 'D', sh: abs(r.shares), g, tax, net: g - tax, fee: 0,
        orig: r.original_currency && r.original_currency !== 'EUR'
          ? `${r.original_amount} ${r.original_currency}` : '',
      });
      p.evs.push(ev);
      continue;
    }

    const sh = abs(r.shares), px = num(r.price);
    if (r.type === 'BUY') {
      let g = abs(r.amount), fee = abs(r.fee), tax = abs(r.tax), note;
      if (r.amount === '') {
        // Compra sin importe en el CSV: el dinero salió antes como pre-pago.
        g = sh * px;
        if (r.asset_class === 'PRIVATE_FUND') {
          const pre = prepays.find((x) => !x.used && x.row.symbol === r.symbol && Math.abs(abs(x.row.amount) - g) < 0.005);
          if (pre) {
            pre.used = true;
            fee = abs(pre.row.fee);
            note = bonusOrders.has(pre.order)
              ? `Pagada con el bonus de Private Markets (${fmtEur(g)} € abonados el ${fmtDate(bonusDates[pre.order])}).`
              : `Pre-pago el ${fmtDate(pre.row.date)}: ${fmtEur(g)} € + ${fmtEur(fee)} € de comisión; participaciones asignadas en la fecha de la operación.`;
          }
        } else {
          const ipo = ipoRows.filter((x) => x.symbol === r.symbol);
          if (ipo.length) {
            const paid = ipo.filter((x) => num(x.amount) < 0).reduce((t, x) => t + abs(x.amount), 0);
            const back = ipo.filter((x) => num(x.amount) > 0).reduce((t, x) => t + abs(x.amount), 0);
            note = `Importe vacío en el CSV (compra vía IPO): cantidad × precio = importe cobrado (${fmtEur(paid)} € pagados − ${fmtEur(back)} € reembolsados).`;
          } else {
            note = 'Importe vacío en el CSV: se usa cantidad × precio.';
          }
        }
      } else if (tax && isSaveback(r)) {
        tax = 0;
      }
      const net = g + fee + tax;
      p.sh += sh;
      p.cost += net;
      p.lots.push({ sh, unit: net / sh, d: r.date });
      Object.assign(ev, { k: 'B', px, sh, g, fee, tax, net, sa: p.sh, ca: p.cost, av: p.cost / p.sh });
      if (note) ev.note = note;
    } else {
      const g = abs(r.amount), fee = abs(r.fee);
      const net = g - fee;
      const avb = p.sh > EPS ? p.cost / p.sh : 0;
      const cs = sh * avb;
      // FIFO (criterio fiscal español): se consumen primero los lotes más antiguos.
      let left = sh, csF = 0;
      const lotsUsed = [];
      while (left > EPS && p.lots.length) {
        const lot = p.lots[0];
        const take = Math.min(lot.sh, left);
        csF += take * lot.unit;
        lotsUsed.push({ d: lot.d, sh: take, unit: lot.unit });
        lot.sh -= take;
        left -= take;
        if (lot.sh < 1e-7) p.lots.shift();
      }
      p.sh -= sh;
      p.cost -= cs;
      if (Math.abs(p.sh) < 1e-7) { p.sh = 0; p.cost = 0; p.lots = []; }
      Object.assign(ev, {
        k: 'S', px, sh, g, fee, tax: 0, net, avb, cs, re: net - cs, sa: p.sh, ca: p.cost,
        csF, reF: net - csF, lotsUsed,
      });
    }
    p.evs.push(ev);
  }

  const positions = [...map.values()].map(({ lots, ...p }) => ({ ...p, open: p.sh > EPS }));

  // Cargos de impuestos sueltos (p. ej. sobre el bonus de Private Markets): se enseñan
  // en el fondo cuya compra coincide en fecha, pero no entran en el coste.
  for (const r of manualTax) {
    const p = positions.find((x) => x.grp === 'pm' && x.evs.some((e) => e.k === 'B' && e.d === r.date));
    if (!p) continue;
    const charge = abs(r.tax);
    const paid = p.evs.filter((e) => e.k === 'B').reduce((t, e) => t + e.net, 0);
    const bonus = p.evs.filter((e) => e.k === 'B' && e.note?.startsWith('Pagada con el bonus')).reduce((t, e) => t + e.g, 0);
    p.extra = `Además hubo un cargo de ${fmtEur(charge)} € (${r.description.replace(/\s+/g, ' ').trim()}, ${fmtDate(r.date)}, ID ${shortId(r.transaction_id)}); no está en la entrada. ` +
      `Efectivo neto salido: ${fmtEur(paid)} € de pre-pagos − ${fmtEur(bonus)} € de bonus + ${fmtEur(charge)} € de cargo = ${fmtEur(paid - bonus + charge)} €.`;
  }

  const dates = events.map((r) => r.date).sort();
  return { positions, lastDate: dates.at(-1) ?? null, firstDate: dates[0] ?? null };
}
