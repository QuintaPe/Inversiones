// Motor de cálculo: convierte las filas del CSV de Trade Republic en posiciones
// con coste medio ponderado. Cada evento guarda los pasos intermedios para que
// el front pueda enseñar de dónde sale cada cifra.

import { parse } from 'csv-parse/sync';

export const REQUIRED_COLUMNS = [
  'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description', 'transaction_id',
];

// Filas de inversión: se guardan completas. Del resto (tarjeta, transferencias, intereses…) se
// guarda fecha, tipo e importe para reconstruir el saldo; en los pagos con tarjeta, además, el
// comercio y su código de categoría (MCC), y en las transferencias el nombre de la otra parte,
// para ver y categorizar los gastos. Nunca el IBAN ni la referencia de la transferencia.
const INVEST_TYPES = new Set([
  'BUY', 'SELL', 'DIVIDEND', 'PRIVATE_MARKET_BUY', 'IPO_SUBSCRIPTION',
  'BONUS', 'MANUAL', 'BENEFITS_SAVEBACK', 'SPIN_OFF',
]);
// Columnas que se guardan si el CSV las trae (las exportaciones antiguas no las tienen).
const OPTIONAL_COLUMNS = ['original_amount', 'original_currency', 'fx_rate', 'account_type', 'currency', 'mcc_code'];
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
      if (!INVEST_TYPES.has(r.type)) {
        const keepName = r.type.startsWith('CARD_') || r.type.startsWith('TRANSFER_') || r.type === 'CUSTOMER_INBOUND';
        if (!keepName) row.name = '';
        if (!r.type.startsWith('CARD_')) row.mcc_code = '';
        row.description = ''; row.symbol = '';
      } else row.mcc_code = '';
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
 * @param splits  por valor: { ISIN: [[fecha, ratio], …] }; ratio = acciones nuevas por cada acción antigua
 */
/** Planes de pensiones españoles: se identifican por su código de la DGSFP («N5396»), no por ISIN. */
const PLAN_ID = /^N\d{4}$/;
/** Tipo de activo: el del CSV o el elegido a mano; un código de plan es siempre un plan de pensiones. */
export const assetClass = (r) => (PLAN_ID.test(r.symbol) ? 'PENSION_PLAN' : r.asset_class);
/**
 * Grupo del filtro del resumen: Private Markets, externos (lo que está fuera de Trade Republic:
 * planes de pensiones y otros activos anotados a mano como externos) o acciones y ETF.
 */
export const assetGroup = (cls) => (cls === 'PRIVATE_FUND' ? 'pm' : cls === 'PENSION_PLAN' || cls === 'EXTERNAL' ? 'ext' : 'ac');
/** Marca de una operación anotada a mano que no pasa por el efectivo de Trade Republic. */
export const NO_CASH = 'EXTERNAL';
/**
 * ¿La operación mueve el efectivo de Trade Republic? No, si se marcó así al anotarla, ni si el
 * activo es externo (un plan de pensiones o algo de otra entidad: su dinero sale de otra cuenta).
 */
export const movesCash = (r) => r.account_type !== NO_CASH && assetGroup(assetClass(r)) !== 'ext';

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
      const cls = assetClass(r);
      map.set(r.symbol, {
        isin: r.symbol, name: r.name, cls, grp: assetGroup(cls),
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

  // Los splits van delante: con la misma hora exacta (una operación a las 00:00:00 UTC de ese día)
  // el orden estable los deja primero, y la operación no se multiplica dos veces.
  const events = [...splitRows, ...trades, ...dividends, ...spinoffs].sort(byTime);
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
    if (r.account_type === NO_CASH) ev.noCash = true; // anotada sin pasar por el efectivo

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

  // Ajustes de impuestos sueltos (p. ej. por el bonus de Private Markets): se enseñan en el
  // fondo cuya compra coincide en fecha, pero no entran en el coste. La columna tax trae el
  // signo del movimiento de efectivo, como en el resto de filas: positivo es un abono.
  for (const r of manualTax) {
    const p = positions.find((x) => x.grp === 'pm' && x.evs.some((e) => e.k === 'B' && e.d === r.date));
    if (!p) continue;
    const t = num(r.tax);
    const paid = p.evs.filter((e) => e.k === 'B').reduce((s, e) => s + e.net, 0);
    const bonus = p.evs.filter((e) => e.k === 'B' && e.note?.startsWith('Pagada con el bonus')).reduce((s, e) => s + e.g, 0);
    p.extra = `Además hubo ${t > 0 ? 'un abono' : 'un cargo'} de ${fmtEur(Math.abs(t))} € (${r.description.replace(/\s+/g, ' ').trim()}, ${fmtDate(r.date)}, ID ${shortId(r.transaction_id)}); no está en la entrada. ` +
      `Efectivo neto salido: ${fmtEur(paid)} € de pre-pagos − ${fmtEur(bonus)} € de bonus ${t > 0 ? '−' : '+'} ${fmtEur(Math.abs(t))} € = ${fmtEur(paid - bonus - t)} €.`;
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
  // Por fecha valor, que es la que se pinta: unas pocas filas se ejecutan días después de
  // su fecha valor y, ordenadas por hora de ejecución, la gráfica volvía hacia atrás.
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || byTime(a, b));
  const totals = {}, months = {}, days = [];
  // Extracto de todos los movimientos de efectivo, con el valor o el comercio si lo hay.
  const moves = [];
  let balance = 0, has = false;
  for (const r of sorted) {
    if (!movesCash(r)) continue; // pagado o cobrado fuera de Trade Republic
    // Importe, comisión e impuesto con su signo: es lo que suma el saldo real de la cuenta.
    const delta = num(r.amount) + num(r.fee) + num(r.tax);
    if (!delta) continue;
    const g = CASH_GROUP[r.type] ?? 'other';
    if (g !== 'invest' && g !== 'dividend' && g !== 'tax') has = true;
    balance += delta;
    totals[g] = (totals[g] ?? 0) + delta;
    const m = (months[r.date.slice(0, 7)] ??= {});
    m[g] = (m[g] ?? 0) + delta;
    // [fecha, concepto, importe, nombre (valor, comercio u otra parte), MCC del comercio]
    const mv = [r.date, g, +delta.toFixed(2)];
    if (r.name || r.mcc_code) mv.push(r.name ?? '');
    if (r.mcc_code) mv.push(r.mcc_code);
    moves.push(mv);
    if (days.length && days.at(-1)[0] === r.date) days.at(-1)[1] = +balance.toFixed(2);
    else days.push([r.date, +balance.toFixed(2)]);
  }
  // Sin ingresos ni tarjeta en los datos, el saldo no es reconstruible (CSV subido antes de guardar el efectivo).
  if (!has) return null;
  const ledger = +balance.toFixed(2);
  // El redondeo de los pagos con tarjeta se reserva al pagar, pero solo aparece en el CSV
  // cuando se invierte (una vez por semana): lo pendiente ya no está disponible.
  const roundUps = pendingRoundUps(sorted);
  const pending = roundUps?.amount ?? 0;
  if (pending) days.at(-1)[1] = +(days.at(-1)[1] - pending).toFixed(2);
  return { balance: +(ledger - pending).toFixed(2), ledger, roundUps, totals, months, days, moves };
}

/** Céntimos que redondea un pago con tarjeta: hasta el euro siguiente, o 1 € si ya es redondo. */
const roundUpCents = (amount) => {
  const cents = Math.round(abs(amount) * 100);
  return (100 - (cents % 100)) % 100 || 100;
};
const ms = (r) => Date.parse(r.datetime);

/**
 * Redondeos de la tarjeta pendientes de invertir. La cuenta los usa si sus compras del
 * plan de ahorro coinciden (al céntimo) con los redondeos de los pagos hechos desde la
 * compra anterior; lo pendiente son los redondeos de los pagos posteriores a la última.
 * Devuelve { amount, n, since } o null si no usa el redondeo o no hay nada pendiente.
 */
export function pendingRoundUps(rows) {
  const sorted = [...rows].sort(byTime);
  const cards = sorted.filter((r) => r.type?.startsWith('CARD_TRANSACTION') && num(r.amount) < 0);
  if (!cards.length) return null;
  let prev = -Infinity, last = null, matches = 0;
  for (const r of sorted) {
    if (r.type !== 'BUY' || !/savings plan/i.test(r.description ?? '') || r.amount === '') continue;
    const t = ms(r);
    const win = cards.reduce((s, c) => (ms(c) > prev && ms(c) <= t ? s + roundUpCents(c.amount) : s), 0);
    if (!win) continue; // otra compra del plan el mismo día: no es la de los redondeos
    if (win === Math.round(abs(r.amount) * 100)) { matches++; last = t; }
    prev = t;
  }
  if (matches < 3 || last == null) return null; // sin un patrón claro, mejor no restar nada
  const pend = cards.filter((c) => ms(c) > last);
  const cents = pend.reduce((s, c) => s + roundUpCents(c.amount), 0);
  return cents ? { amount: cents / 100, n: pend.length, since: new Date(last).toISOString().slice(0, 10) } : null;
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
    } else if (r.type === 'MANUAL' && num(r.tax) < 0) {
      // Cargo de impuestos suelto (p. ej. por el bonus). Los positivos son abonos, no retenciones.
      slot(r, 'reward').t += abs(r.tax);
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
    account_type: op.cash === false ? NO_CASH : '', currency: 'EUR',
  };
  if (op.type === 'DIVIDEND') {
    return { ...base, category: 'CASH', type: 'DIVIDEND', shares: sh ? String(sh) : '', price: '', amount: Math.abs(op.amount).toFixed(2) };
  }
  const gross = (sh * px).toFixed(2);
  return op.type === 'BUY'
    ? { ...base, category: 'TRADING', type: 'BUY', shares: String(sh), price: String(px), amount: `-${gross}` }
    : { ...base, category: 'TRADING', type: 'SELL', shares: String(-sh), price: String(px), amount: gross, tax: '' };
}
