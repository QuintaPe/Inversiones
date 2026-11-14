// Copia de los datos de un usuario (la que descarga GET /api/export): se lee, se valida y se
// limpia antes de restaurarla. Nada del archivo llega a la base de datos sin pasar por aquí.
import { ROW_COLS } from './db.js';
import { isDate, parsePrice } from './lib/validate.js';

export class BackupError extends Error {}

const MAX_ROWS = 200_000;
const MAX_FIELD = 500;
const str = (v, max = MAX_FIELD) => (v == null ? '' : String(v).slice(0, max));
const list = (v) => (Array.isArray(v) ? v : []);
const stamp = (v) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v.slice(0, 40) : null);
const isin = (v) => { const s = str(v, 20).trim().toUpperCase(); return s || null; };

/**
 * @param text  contenido del archivo .json
 * @returns { exported_at, transactions, prices, valuations, alerts, targets, imports, merchant_categories, budgets }
 */
export function readBackup(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new BackupError('El archivo no es una copia válida (no es JSON).'); }
  if (raw?.app !== 'cartera' || !Array.isArray(raw.transactions)) throw new BackupError('El archivo no es una copia descargada desde esta app.');
  if (!(raw.version >= 1 && raw.version <= 2)) throw new BackupError('La copia es de una versión de la app que no se puede restaurar aquí.');
  if (raw.transactions.length > MAX_ROWS) throw new BackupError('La copia tiene demasiadas operaciones.');

  const seen = new Set();
  const transactions = [];
  for (const t of raw.transactions) {
    const row = Object.fromEntries(ROW_COLS.map((k) => [k, str(t?.[k])]));
    if (!row.transaction_id || !isDate(row.date) || !row.type) throw new BackupError('La copia tiene operaciones incompletas (sin identificador, fecha o tipo).');
    if (seen.has(row.transaction_id)) continue;
    seen.add(row.transaction_id);
    transactions.push({ ...row, source: t.source === 'manual' ? 'manual' : 'csv', deleted_at: stamp(t.deleted_at) });
  }
  const now = new Date().toISOString();
  const uniq = (rows, key) => [...new Map(rows.map((r) => [key(r), r])).values()];
  return {
    exported_at: stamp(raw.exported_at),
    transactions,
    prices: uniq(list(raw.prices).map((p) => ({ isin: isin(p?.isin), price: parsePrice(p?.price), updated_at: stamp(p?.updated_at) ?? now }))
      .filter((p) => p.isin && p.price), (p) => p.isin),
    valuations: uniq(list(raw.valuations).map((v) => ({ isin: isin(v?.isin), d: str(v?.d, 10), price: parsePrice(v?.price) }))
      .filter((v) => v.isin && v.price && isDate(v.d)), (v) => `${v.isin}|${v.d}`),
    alerts: list(raw.alerts).map((a) => ({ isin: isin(a?.isin), dir: a?.dir, price: parsePrice(a?.price), created_at: stamp(a?.created_at) ?? now, triggered_at: stamp(a?.triggered_at) }))
      .filter((a) => a.isin && a.price && ['above', 'below', 'move'].includes(a.dir)).slice(0, 200),
    targets: uniq(list(raw.targets).map((t) => ({ isin: isin(t?.isin), weight: Number(t?.weight) }))
      .filter((t) => t.isin && t.weight >= 0 && t.weight <= 100), (t) => t.isin),
    imports: list(raw.imports).map((i) => ({
      name: str(i?.name, 200), uploaded_at: stamp(i?.uploaded_at) ?? now, total: Number(i?.total) || 0, relevant: Number(i?.relevant) || 0,
      added: Number(i?.added) || 0, sha256: /^[0-9a-f]{64}$/.test(i?.sha256 ?? '') ? i.sha256 : null,
    })).slice(-500),
    merchant_categories: uniq(list(raw.merchant_categories).map((m) => ({ merchant: str(m?.merchant, 200).trim(), category: str(m?.category, 40) }))
      .filter((m) => m.merchant && /^[a-z]+$/.test(m.category)), (m) => m.merchant),
    budgets: uniq(list(raw.budgets).map((x) => ({ category: str(x?.category, 40), amount: parsePrice(x?.amount) }))
      .filter((x) => /^[a-z]+$/.test(x.category) && x.amount), (x) => x.category),
  };
}

/** Lo que se enseña antes de restaurar: qué trae la copia. */
export function backupSummary(b) {
  const live = b.transactions.filter((t) => !t.deleted_at);
  const dates = live.map((t) => t.date).sort();
  return {
    exported_at: b.exported_at, transactions: live.length, removed: b.transactions.length - live.length,
    manual: live.filter((t) => t.source === 'manual').length, from: dates[0] ?? null, to: dates.at(-1) ?? null,
    prices: b.prices.length, valuations: b.valuations.length, alerts: b.alerts.length, targets: b.targets.length, categories: b.merchant_categories.length,
  };
}
