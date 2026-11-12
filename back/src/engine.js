// Motor de cálculo: convierte las filas del CSV de Trade Republic en posiciones
// con coste medio ponderado. Cada evento guarda los pasos intermedios para que
// el front pueda enseñar de dónde sale cada cifra.

import { parse } from 'csv-parse/sync';

export const REQUIRED_COLUMNS = [
  'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description', 'transaction_id',
];

// Filas de inversión: se guardan completas. El resto (tarjeta, transferencias,
// intereses…) solo se guarda como fecha, tipo e importe, sin comercio ni concepto,
// para poder reconstruir el saldo de efectivo.
const INVEST_TYPES = new Set([
  'BUY', 'SELL', 'DIVIDEND', 'PRIVATE_MARKET_BUY', 'IPO_SUBSCRIPTION',
  'BONUS', 'MANUAL', 'BENEFITS_SAVEBACK', 'SPIN_OFF',
]);
// Columnas que se guardan si el CSV las trae (las exportaciones antiguas no las tienen).
const OPTIONAL_COLUMNS = ['original_amount', 'original_currency', 'fx_rate', 'account_type', 'currency'];
const SKIP_TYPES = new Set(['MIGRATION']); // traspasos internos: ni mueven efectivo ni cambian la posición
export const isInvestRow = (r) => INVEST_TYPES.has(r.type);

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
    .filter((r) => r.transaction_id && r.type && !SKIP_TYPES.has(r.type))
    .map((r) => {
      const row = {};
      for (const c of REQUIRED_COLUMNS) row[c] = r[c] ?? '';
      for (const c of OPTIONAL_COLUMNS) row[c] = r[c] ?? '';
      if (!INVEST_TYPES.has(r.type)) { row.name = ''; row.description = ''; row.symbol = ''; }
      return row;
    });
  return { total: records.length, rows, invest: rows.filter(isInvestRow).length, unknown: unknownTypes(rows) };
}

/**
 * Tipos de fila que el motor todavía no sabe interpretar: { tipo: nº de filas }.
 * Se avisa de ellos en vez de ignorarlos en silencio.
 */
export function unknownTypes(rows) {
  const out = {};
  for (const r of rows) {
    if (INVEST_TYPES.has(r.type) || CASH_GROUP[r.type]) continue;
    out[r.type] = (out[r.type] ?? 0) + 1;
  }
  return out;
}

const byTime = (a, b) => {
  const d = Date.parse(a.datetime) - Date.parse(b.datetime);
  return d || (a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0);
};

/** Id de orden citado en la descripción ("… for buy order: <uuid>"). */
const orderId = (desc) => (desc.match(/for buy order:\s*([0-9a-f-]{36})/i) || [])[1];

/**
 * El proveedor también publica como "split" el ajuste de precio de una escisión (p. ej. 1,067),
 * que no cambia el número de acciones. Solo se aplican las proporciones de un split real:
 * a:b con números pequeños (4:1, 3:2, 20:1, 1:10…).
 */
export function isShareSplit(ratio) {
  if (!(ratio > 0) || ratio === 1) return false;
  const r = ratio > 1 ? ratio : 1 / ratio;
  for (let b = 1; b <= 10; b++) {
    const a = Math.round(r * b);
    if (a <= 100 && Math.abs(a / b - r) < 1e-6 * r) return true;
  }
  return false;
}

/**
 * @param rows    filas guardadas del CSV y operaciones a mano
 * @param splits  { ISIN: [[fecha, ratio], …] }; ratio = acciones nuevas por cada acción antigua
 */
export function buildPortfolio(rows, splits = {}) {
  const sorted = [...rows].sort(byTime);
  const trades = sorted.filter((r) => r.category === 'TRADING' && (r.type === 'BUY' || r.type === 'SELL'));
  const dividends = sorted.filter((r) => r.type === 'DIVIDEND');
  // Escisiones: acciones de una empresa nueva recibidas sin pagar nada.
  const spinoffs = sorted.filter((r) => r.type === 'SPIN_OFF' && r.symbol && num(r.shares) > 0);

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

  // Los splits entran como eventos al empezar su día: las operaciones de esa fecha ya van en acciones nuevas.
  const held = new Set([...trades, ...spinoffs].map((r) => r.symbol));
  const splitRows = Object.entries(splits).filter(([isin]) => held.has(isin)).flatMap(([isin, list]) =>
    list.filter(([, ratio]) => isShareSplit(ratio)).map(([d, ratio]) => ({
      type: 'SPLIT', symbol: isin, date: d, datetime: `${d}T00:00:00.000Z`, ratio, transaction_id: `split-${isin}-${d}`,
    })));

  const events = [...trades, ...dividends, ...spinoffs, ...splitRows].sort(byTime);
  for (const r of events) {
    if (!r.symbol) continue;
    if (r.type === 'SPLIT') {
      const p = map.get(r.symbol);
      if (!p || p.sh <= EPS) continue; // sin acciones ese día, el split no cambia nada
      const before = p.sh;
      p.sh *= r.ratio;
      for (const lot of p.lots) { lot.sh *= r.ratio; lot.unit /= r.ratio; }
      // El coste total no cambia: solo se reparte entre más (o menos) acciones.
      p.evs.push({
        id: `split-${r.date}`, tid: r.transaction_id, d: r.date, k: 'X', ratio: r.ratio,
        from: before, sh: p.sh, px: 0, g: 0, fee: 0, tax: 0, net: 0, sa: p.sh, ca: p.cost, av: p.cost / p.sh,
      });
      continue;
    }
    const p = get(r);
    const ev = { id: shortId(r.transaction_id), tid: r.transaction_id, d: r.date };

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
    if (r.type === 'SPIN_OFF') {
      // Entran a coste cero: el CSV no dice de qué empresa salen ni qué parte de su coste
      // les corresponde, así que al venderlas todo el importe cuenta como ganancia.
      p.sh += sh;
      p.lots.push({ sh, unit: 0, d: r.date });
      Object.assign(ev, {
        k: 'B', spin: true, px: 0, sh, g: 0, fee: 0, tax: 0, net: 0, sa: p.sh, ca: p.cost, av: p.cost / p.sh,
        note: 'Acciones recibidas por una escisión (spin-off), sin desembolso: entran a coste cero.',
      });
    } else if (r.type === 'BUY') {
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

  const positions = [...map.values()].map((p) => ({ ...p, open: p.sh > EPS }));

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

  const dates = events.filter((r) => r.type !== 'SPLIT').map((r) => r.date).sort();
  return { positions, lastDate: dates.at(-1) ?? null, firstDate: dates[0] ?? null };
}

// ---------- efectivo ----------
const CASH_GROUP = {
  CUSTOMER_INBOUND: 'deposit', TRANSFER_INBOUND: 'deposit', TRANSFER_INSTANT_INBOUND: 'deposit',
  TRANSFER_INSTANT_OUTBOUND: 'withdrawal', TRANSFER_OUTBOUND: 'withdrawal', TRANSFER_DIRECT_DEBIT_INBOUND: 'withdrawal',
  CARD_TRANSACTION: 'card', CARD_TRANSACTION_INTERNATIONAL: 'card', CARD_ORDERING_FEE: 'card',
  INTEREST_PAYMENT: 'interest', BENEFITS_SAVEBACK: 'reward', BONUS: 'reward',
  BUY: 'invest', SELL: 'invest', PRIVATE_MARKET_BUY: 'invest', IPO_SUBSCRIPTION: 'invest',
  DIVIDEND: 'dividend', MANUAL: 'tax',
  SPIN_OFF: 'invest', // no mueve efectivo; aquí solo para que conste como tipo conocido
};
export const CASH_LABEL = {
  deposit: 'Ingresos', withdrawal: 'Retiradas y recibos', card: 'Tarjeta', interest: 'Intereses',
  reward: 'Saveback y bonus', invest: 'Compras y ventas', dividend: 'Dividendos', tax: 'Impuestos', other: 'Otros',
};

/** Saldo de efectivo día a día y totales por concepto, a partir de todas las filas. */
export function buildCash(rows) {
  const sorted = [...rows].sort(byTime);
  const totals = {}, months = {}, days = [];
  let balance = 0, has = false;
  for (const r of sorted) {
    // Los cargos sueltos de impuestos vienen con el importe en positivo en la columna tax.
    const tax = r.type === 'MANUAL' ? -abs(r.tax) : num(r.tax);
    const delta = num(r.amount) + num(r.fee) + tax;
    if (!delta) continue;
    const g = CASH_GROUP[r.type] ?? 'other';
    if (g !== 'invest' && g !== 'dividend' && g !== 'tax') has = true;
    balance += delta;
    totals[g] = (totals[g] ?? 0) + delta;
    const m = (months[r.date.slice(0, 7)] ??= {});
    m[g] = (m[g] ?? 0) + delta;
    if (days.length && days.at(-1)[0] === r.date) days.at(-1)[1] = +balance.toFixed(2);
    else days.push([r.date, +balance.toFixed(2)]);
  }
  // Sin ingresos ni tarjeta en los datos, el saldo no es reconstruible (CSV subido antes de guardar el efectivo).
  return has ? { balance: +balance.toFixed(2), totals, months, days } : null;
}

/**
 * Rendimientos que no son dividendos, por ejercicio: intereses de la cuenta y premios
 * (saveback y bonus), con su retención. { año: { interest: { g, t, n }, reward: { g, t, n } } }
 */
export function buildIncome(rows) {
  const out = {};
  const slot = (r, k) => ((out[r.date.slice(0, 4)] ??= { interest: { g: 0, t: 0, n: 0 }, reward: { g: 0, t: 0, n: 0 } })[k]);
  const savebacks = rows.filter((r) => r.type === 'BENEFITS_SAVEBACK' && r.symbol);
  for (const r of rows) {
    if (r.type === 'INTEREST_PAYMENT') {
      const s = slot(r, 'interest');
      s.g += num(r.amount); s.t += abs(r.tax); s.n++;
    } else if (r.type === 'BENEFITS_SAVEBACK' || r.type === 'BONUS') {
      const s = slot(r, 'reward');
      s.g += num(r.amount); s.t += abs(r.tax); s.n++;
    } else if (r.type === 'MANUAL' && abs(r.tax) > 0) {
      slot(r, 'reward').t += abs(r.tax); // cargo de impuestos suelto (p. ej. por el bonus)
    } else if (r.type === 'BUY' && abs(r.tax) > 0 && r.amount !== ''
      && savebacks.some((s) => s.symbol === r.symbol && s.date === r.date && Math.abs(abs(s.amount) - abs(r.amount)) < 0.005)) {
      slot(r, 'reward').t += abs(r.tax); // la retención del saveback viene en la compra que financia
    }
  }
  return out;
}

/** Fila de transacción a partir de una operación introducida a mano. */
export function manualRow(op, id) {
  const sh = Math.abs(op.shares) || 0, px = Math.abs(op.price) || 0;
  const fee = Math.abs(op.fee) || 0, tax = Math.abs(op.tax) || 0;
  const base = {
    transaction_id: id, datetime: `${op.date}T12:00:00.000Z`, date: op.date,
    asset_class: op.asset_class || 'STOCK', name: op.name, symbol: op.isin,
    fee: fee ? (-fee).toFixed(2) : '', tax: tax ? (-tax).toFixed(2) : '',
    description: 'Operación manual', original_amount: '', original_currency: '', fx_rate: '',
    account_type: '', currency: 'EUR',
  };
  if (op.type === 'DIVIDEND') {
    return { ...base, category: 'CASH', type: 'DIVIDEND', shares: sh ? String(sh) : '', price: '', amount: Math.abs(op.amount).toFixed(2) };
  }
  const gross = (sh * px).toFixed(2);
  return op.type === 'BUY'
    ? { ...base, category: 'TRADING', type: 'BUY', shares: String(sh), price: String(px), amount: `-${gross}` }
    : { ...base, category: 'TRADING', type: 'SELL', shares: String(-sh), price: String(px), amount: gross, tax: '' };
}
