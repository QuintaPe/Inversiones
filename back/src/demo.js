// Cartera de ejemplo para probar la app sin subir un CSV. Son valores reales (sus cotizaciones
// en vivo y su histórico funcionan) con compras a precios aproximados a los de cada fecha, un
// plan de ahorro mensual, alguna venta, dividendos con su retención, ingresos e intereses.
// Las fechas se cuentan hacia atrás desde hoy, para que la cartera parezca siempre reciente.
import { parseCsv } from './engine.js';

export const DEMO_PREFIX = 'demo-';
export const DEMO_TTL_DAYS = 7; // las cuentas de ejemplo se borran pasada una semana sin usarse

// Precio aproximado en euros en distintas fechas (se interpola entre ellas).
const ASSETS = {
  IE00B4L5Y983: { name: 'iShares Core MSCI World USD (Acc)', cls: 'FUND', px: [['2023-01', 72], ['2024-01', 85], ['2025-01', 105], ['2025-06', 98], ['2026-01', 110]] },
  IE00BK5BQT80: { name: 'Vanguard FTSE All-World USD (Acc)', cls: 'FUND', px: [['2023-01', 92], ['2024-01', 108], ['2025-01', 132], ['2025-06', 125], ['2026-01', 140]] },
  US0378331005: { name: 'Apple', cls: 'STOCK', px: [['2023-01', 120], ['2024-01', 170], ['2025-01', 235], ['2025-06', 175], ['2026-01', 230]], div: { every: 3, start: 2, ps: 0.23, wh: 0.15 } },
  US5949181045: { name: 'Microsoft', cls: 'STOCK', px: [['2023-01', 225], ['2024-01', 345], ['2025-01', 410], ['2025-06', 420], ['2026-01', 410]], div: { every: 3, start: 3, ps: 0.75, wh: 0.15 } },
  US67066G1040: { name: 'NVIDIA', cls: 'STOCK', px: [['2023-01', 14], ['2024-01', 45], ['2024-07', 115], ['2025-01', 132], ['2025-06', 125], ['2026-01', 160]] },
  NL0010273215: { name: 'ASML Holding', cls: 'STOCK', px: [['2023-01', 520], ['2024-01', 680], ['2025-01', 690], ['2025-06', 680], ['2026-01', 900]] },
  ES0144580Y14: { name: 'Iberdrola', cls: 'STOCK', px: [['2023-01', 10.9], ['2024-01', 11.8], ['2025-01', 13.3], ['2025-06', 15.5], ['2026-01', 17]], div: { every: 6, start: 1, ps: 0.2, wh: 0.19 } },
  ES0148396007: { name: 'Inditex', cls: 'STOCK', px: [['2023-01', 25], ['2024-01', 39], ['2025-01', 50], ['2025-06', 45], ['2026-01', 50]], div: { every: 6, start: 5, ps: 0.75, wh: 0.19 } },
  DE0008404005: { name: 'Allianz', cls: 'STOCK', px: [['2023-01', 200], ['2024-01', 245], ['2025-01', 295], ['2025-06', 340], ['2026-01', 360]], div: { every: 12, start: 5, ps: 13.8, wh: 0.26375 } },
  US1912161007: { name: 'Coca-Cola', cls: 'STOCK', px: [['2023-01', 58], ['2024-01', 54], ['2025-01', 60], ['2025-06', 61], ['2026-01', 60]], div: { every: 3, start: 4, ps: 0.47, wh: 0.15 } },
};

const ms = (ym) => Date.parse(`${ym.length === 7 ? `${ym}-01` : ym}T00:00:00Z`);
function priceAt(isin, d) {
  const pts = ASSETS[isin].px, t = ms(d);
  if (t <= ms(pts[0][0])) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [ms(pts[i - 1][0]), ms(pts[i][0])];
    if (t <= b) return pts[i - 1][1] + ((pts[i][1] - pts[i - 1][1]) * (t - a)) / (b - a);
  }
  return pts.at(-1)[1];
}

// Compras sueltas: [meses desde el inicio, ISIN, importe aproximado en euros].
const BUYS = [
  [1, 'US0378331005', 1500], [2, 'US5949181045', 2000], [3, 'ES0144580Y14', 1200], [4, 'NL0010273215', 1500],
  [6, 'DE0008404005', 1500], [7, 'US1912161007', 1000], [9, 'ES0148396007', 1000], [12, 'US0378331005', 800],
  [14, 'US67066G1040', 1500], [17, 'US5949181045', 1000], [20, 'NL0010273215', 800], [23, 'US67066G1040', 800],
  [27, 'ES0144580Y14', 600], [30, 'DE0008404005', 700],
];
// Gastos de cada mes: [comercio, MCC, pagos al mes, importe mínimo, máximo, cada cuántos meses].
const SPEND = [
  ['MERCADONA', '5411', 3, 35, 80], ['LIDL', '5411', 1, 18, 45], ['REPSOL', '5541', 1, 40, 62],
  ['NETFLIX.COM', '4899', 1, 13.99, 13.99], ['SPOTIFY', '5815', 1, 11.99, 11.99], ['RENFE VIAJEROS', '4112', 1, 14, 36],
  ['LA TAGLIATELLA', '5812', 2, 24, 58], ['BAR EL RINCÓN', '5813', 2, 6, 18], ['FARMACIA CENTRAL', '5912', 1, 8, 24],
  ['AMAZON', '5999', 1, 15, 70], ['ZARA', '5651', 1, 29, 79, 2], ['CINESA', '7832', 1, 9, 19, 2], ['DECATHLON', '5941', 1, 20, 60, 4],
];
// Pseudoaleatorio con semilla (mulberry32): el ejemplo sale siempre igual.
const rng = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Ventas: [meses desde el inicio, ISIN, parte de lo que se tiene].
const SELLS = [[26, 'US67066G1040', 0.4], [33, 'US1912161007', 0.5]];

/** Filas como las de un CSV de Trade Republic, de hace 36 meses a hoy. */
export function demoRows(now = Date.now()) {
  const head = '"datetime","date","category","type","asset_class","name","symbol","shares","price","amount","fee","tax","description","transaction_id","mcc_code"';
  const lines = [head];
  const today = new Date(now);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 36, 1);
  const held = {};
  let n = 0, cash = 0;
  const q = (v) => `"${v}"`;
  const at = (month, day, hour = 10) => {
    const t = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth() + month, day, hour);
    return t > now ? null : new Date(t).toISOString();
  };
  const push = (dt, cat, type, isin, shares, price, amount, fee, tax, desc, who = '', mcc = '') => {
    const a = isin ? ASSETS[isin] : null;
    cash += amount + fee + tax;
    lines.push([dt, dt.slice(0, 10), cat, type, a?.cls ?? '', a?.name ?? who, isin ?? '', shares, price, amount.toFixed(2),
      fee ? fee.toFixed(2) : '', tax ? tax.toFixed(2) : '', desc, `demo-${++n}`, mcc].map(q).join(','));
  };
  const buy = (dt, isin, eur, fee, desc = 'Buy trade') => {
    const px = +priceAt(isin, dt).toFixed(2);
    const sh = +(eur / px).toFixed(6);
    held[isin] = (held[isin] ?? 0) + sh;
    push(dt, 'TRADING', 'BUY', isin, sh, px, -+(sh * px).toFixed(2), -fee, 0, desc);
  };

  for (let m = 0; m <= 36; m++) {
    const pay = at(m, 1, 8);
    if (!pay) break;
    push(pay, 'CASH', 'CUSTOMER_INBOUND', null, '', '', m === 0 ? 8000 : 1600, 0, 0, 'Ingreso', 'Nómina');
    // Pagos con tarjeta del mes y algún Bizum.
    const r = rng(m + 1);
    for (const [who, mcc, times, lo, hi, every = 1] of SPEND) {
      if (m % every !== 0) continue;
      for (let k = 0; k < times; k++) {
        const dt = at(m, 3 + Math.floor(r() * 25), 11 + Math.floor(r() * 9));
        if (dt) push(dt, 'CASH', 'CARD_TRANSACTION', null, '', '', -+(lo + (hi - lo) * r()).toFixed(2), 0, 0, 'Card', who, mcc);
      }
    }
    const bz = at(m, 20, 19);
    if (bz && m % 2 === 1) push(bz, 'CASH', 'TRANSFER_INSTANT_OUTBOUND', null, '', '', -+(15 + 30 * r()).toFixed(2), 0, 0, 'Bizum', 'Ana García');
    // Plan de ahorro: dos ETF el día 2 de cada mes, sin comisión.
    for (const [isin, eur] of [['IE00B4L5Y983', 450], ['IE00BK5BQT80', 250]]) {
      const dt = at(m, 2, 9);
      if (dt) buy(dt, isin, eur, 0, 'Savings plan execution');
    }
    for (const [mm, isin, eur] of BUYS) if (mm === m) { const dt = at(m, 12, 15); if (dt) buy(dt, isin, eur, 1); }
    for (const [mm, isin, part] of SELLS) {
      const dt = at(m, 18, 16);
      if (mm !== m || !dt || !held[isin]) continue;
      const sh = +(held[isin] * part).toFixed(6), px = +priceAt(isin, dt).toFixed(2);
      held[isin] -= sh;
      push(dt, 'TRADING', 'SELL', isin, sh, px, +(sh * px).toFixed(2), -1, 0, 'Sell trade');
    }
    // Dividendos del mes, con la retención en origen.
    for (const [isin, a] of Object.entries(ASSETS)) {
      const dt = at(m, 15, 7);
      if (!a.div || !dt || !held[isin] || (m - a.div.start) % a.div.every !== 0 || m < a.div.start) continue;
      const gross = +(held[isin] * a.div.ps).toFixed(2);
      if (gross > 0.01) push(dt, 'CASH', 'DIVIDEND', isin, held[isin].toFixed(6), '', gross, 0, -+(gross * a.div.wh).toFixed(2), 'Dividend');
    }
    // Intereses del efectivo (2 % anual, menos la retención española).
    const it = at(m, 28, 6);
    if (it && cash > 0) {
      const gross = +((cash * 0.02) / 12).toFixed(2);
      if (gross > 0) push(it, 'CASH', 'INTEREST_PAYMENT', null, '', '', gross, 0, -+(gross * 0.19).toFixed(2), 'Interest');
    }
  }
  return parseCsv(lines.join('\n'));
}
