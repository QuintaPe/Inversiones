// Acceso a Turso (libSQL). Sin TURSO_DATABASE_URL usa un fichero SQLite local,
// para poder desarrollar sin tocar la base de datos remota.
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROW_COLS = [
  'transaction_id', 'datetime', 'date', 'category', 'type', 'asset_class', 'name', 'symbol',
  'shares', 'price', 'amount', 'fee', 'tax', 'description',
  'original_amount', 'original_currency', 'fx_rate',
];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT, picture TEXT,
     created_at TEXT NOT NULL, last_login TEXT NOT NULL)`,
  // Los importes se guardan tal cual vienen en el CSV (texto) para no perder precisión.
  `CREATE TABLE IF NOT EXISTS transactions (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     ${ROW_COLS.map((c) => `${c} TEXT NOT NULL DEFAULT ''`).join(', ')},
     PRIMARY KEY (user_id, transaction_id))`,
  `CREATE TABLE IF NOT EXISTS prices (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     isin TEXT NOT NULL, price REAL NOT NULL, updated_at TEXT NOT NULL,
     PRIMARY KEY (user_id, isin))`,
  // Caché global ISIN → símbolo de cotización (symbol NULL = no encontrado).
  `CREATE TABLE IF NOT EXISTS symbols (
     isin TEXT PRIMARY KEY, symbol TEXT, exchange TEXT, resolved_at TEXT NOT NULL)`,
  // Histórico diario de cierres (global, por símbolo y en su divisa) y su estado.
  `CREATE TABLE IF NOT EXISTS price_history (
     symbol TEXT NOT NULL, d TEXT NOT NULL, c REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS history_meta (
     symbol TEXT PRIMARY KEY, currency TEXT NOT NULL, from_d TEXT NOT NULL, last_d TEXT, fetched_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS symbol_divs (
     symbol TEXT NOT NULL, d TEXT NOT NULL, amount REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
  // Valoraciones con fecha que anota el usuario para lo que no cotiza (Private Markets…).
  // Splits por símbolo: ratio = acciones nuevas por cada acción antigua.
  `CREATE TABLE IF NOT EXISTS symbol_splits (
     symbol TEXT NOT NULL, d TEXT NOT NULL, ratio REAL NOT NULL, PRIMARY KEY (symbol, d)) WITHOUT ROWID`,
  `CREATE TABLE IF NOT EXISTS valuations (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     isin TEXT NOT NULL, d TEXT NOT NULL, price REAL NOT NULL, PRIMARY KEY (user_id, isin, d))`,
  // Alertas de precio y pesos objetivo de la cartera.
  `CREATE TABLE IF NOT EXISTS alerts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     isin TEXT NOT NULL, dir TEXT NOT NULL, price REAL NOT NULL, created_at TEXT NOT NULL, triggered_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS targets (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     isin TEXT NOT NULL, weight REAL NOT NULL, PRIMARY KEY (user_id, isin))`,
  // Logotipos por ISIN (data NULL = no hay; se reintenta pasado un mes).
  `CREATE TABLE IF NOT EXISTS logos (isin TEXT PRIMARY KEY, type TEXT, data BLOB, fetched_at TEXT NOT NULL)`,
  // Operaciones del CSV que el usuario ha quitado: no vuelven al resubir el archivo.
  `CREATE TABLE IF NOT EXISTS removed (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     transaction_id TEXT NOT NULL, row TEXT NOT NULL, removed_at TEXT NOT NULL,
     PRIMARY KEY (user_id, transaction_id))`,
  `CREATE TABLE IF NOT EXISTS uploads (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     name TEXT NOT NULL, uploaded_at TEXT NOT NULL,
     total INTEGER NOT NULL, relevant INTEGER NOT NULL, added INTEGER NOT NULL)`,
];

// Columnas añadidas después de la primera versión (source: 'manual' | 'live').
const MIGRATIONS = [
  "ALTER TABLE prices ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
  'ALTER TABLE prices ADD COLUMN info TEXT',
  'ALTER TABLE symbols ADD COLUMN sector TEXT',
  'ALTER TABLE symbols ADD COLUMN industry TEXT',
  // Versión de la ficha: las anteriores a SYMBOL_V se vuelven a buscar una vez.
  'ALTER TABLE symbols ADD COLUMN v INTEGER NOT NULL DEFAULT 1',
  // Versión del histórico: los anteriores a HISTORY_V se descargan enteros otra vez.
  'ALTER TABLE history_meta ADD COLUMN v INTEGER NOT NULL DEFAULT 1',
];
export const HISTORY_V = 2; // 2 = incluye los splits
const SYMBOL_V = 2; // 2 = incluye sector e industria
const RETRY_UNKNOWN_MS = 7 * 86400000; // un ISIN sin símbolo se reintenta a la semana

export async function openDb({ url = process.env.TURSO_DATABASE_URL, authToken = process.env.TURSO_AUTH_TOKEN } = {}) {
  if (!url) {
    const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
    fs.mkdirSync(dir, { recursive: true });
    url = `file:${path.join(dir, 'local.db')}`;
  }
  const client = createClient({ url, authToken });
  await client.batch(SCHEMA, 'write');
  for (const sql of MIGRATIONS) {
    try {
      await client.execute(sql);
    } catch (err) {
      if (!/duplicate column/i.test(err.message)) throw err;
    }
  }
  return makeRepo(client, url);
}

function makeRepo(client, url) {
  const now = () => new Date().toISOString();
  return {
    url,
    close: () => client.close(),

    async upsertUser({ id, email, name, picture }) {
      const t = now();
      await client.execute({
        sql: `INSERT INTO users (id, email, name, picture, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET email = excluded.email, name = excluded.name,
                picture = excluded.picture, last_login = excluded.last_login`,
        args: [id, email, name ?? null, picture ?? null, t, t],
      });
    },

    async getUser(id) {
      const r = await client.execute({ sql: 'SELECT id, email, name, picture FROM users WHERE id = ?', args: [id] });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },

    async getRows(userId) {
      const r = await client.execute({
        sql: `SELECT ${ROW_COLS.join(', ')} FROM transactions WHERE user_id = ?`,
        args: [userId],
      });
      return r.rows.map((x) => ({ ...x }));
    },

    /** Inserta/actualiza filas del CSV en una sola transacción. Devuelve cuántas eran nuevas. */
    async saveUpload(userId, { name, total, rows, replace, relevant }) {
      const gone = new Set((await client.execute({ sql: 'SELECT transaction_id FROM removed WHERE user_id = ?', args: [userId] }))
        .rows.map((x) => x.transaction_id));
      rows = rows.filter((r) => !gone.has(r.transaction_id));
      const existing = replace
        ? new Set()
        : new Set((await client.execute({ sql: 'SELECT transaction_id FROM transactions WHERE user_id = ?', args: [userId] }))
            .rows.map((x) => x.transaction_id));
      const added = rows.filter((r) => !existing.has(r.transaction_id)).length;
      const info = { name, at: now(), total, relevant: relevant ?? rows.length, added };
      const sql = `INSERT OR REPLACE INTO transactions (user_id, ${ROW_COLS.join(', ')})
                   VALUES (?, ${ROW_COLS.map(() => '?').join(', ')})`;
      await client.batch(
        [
          ...(replace ? [{ sql: 'DELETE FROM transactions WHERE user_id = ?', args: [userId] }] : []),
          ...rows.map((r) => ({ sql, args: [userId, ...ROW_COLS.map((c) => r[c] ?? '')] })),
          {
            sql: 'INSERT INTO uploads (user_id, name, uploaded_at, total, relevant, added) VALUES (?, ?, ?, ?, ?, ?)',
            args: [userId, info.name, info.at, total, info.relevant, added],
          },
        ],
        'write',
      );
      return info;
    },

    async getRow(userId, tid) {
      const r = await client.execute({ sql: `SELECT ${ROW_COLS.join(', ')} FROM transactions WHERE user_id = ? AND transaction_id = ?`, args: [userId, tid] });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },
    async putRow(userId, row) {
      await client.execute({
        sql: `INSERT OR REPLACE INTO transactions (user_id, ${ROW_COLS.join(', ')}) VALUES (?, ${ROW_COLS.map(() => '?').join(', ')})`,
        args: [userId, ...ROW_COLS.map((c) => row[c] ?? '')],
      });
    },
    /** Quita una operación. Las del CSV se recuerdan para no reaparecer al resubirlo. */
    async removeRow(userId, row, remember) {
      await client.batch([
        { sql: 'DELETE FROM transactions WHERE user_id = ? AND transaction_id = ?', args: [userId, row.transaction_id] },
        ...(remember ? [{
          sql: 'INSERT OR REPLACE INTO removed (user_id, transaction_id, row, removed_at) VALUES (?, ?, ?, ?)',
          args: [userId, row.transaction_id, JSON.stringify(row), now()],
        }] : []),
      ], 'write');
    },
    async getRemoved(userId) {
      const r = await client.execute({ sql: 'SELECT row, removed_at FROM removed WHERE user_id = ? ORDER BY removed_at DESC', args: [userId] });
      return r.rows.map((x) => ({ ...JSON.parse(x.row), removed_at: x.removed_at }));
    },
    async restoreRow(userId, tid) {
      const r = await client.execute({ sql: 'SELECT row FROM removed WHERE user_id = ? AND transaction_id = ?', args: [userId, tid] });
      if (!r.rows[0]) return false;
      const row = JSON.parse(r.rows[0].row);
      await client.batch([
        { sql: `INSERT OR REPLACE INTO transactions (user_id, ${ROW_COLS.join(', ')}) VALUES (?, ${ROW_COLS.map(() => '?').join(', ')})`, args: [userId, ...ROW_COLS.map((c) => row[c] ?? '')] },
        { sql: 'DELETE FROM removed WHERE user_id = ? AND transaction_id = ?', args: [userId, tid] },
      ], 'write');
      return true;
    },

    async lastUpload(userId) {
      const r = await client.execute({
        sql: 'SELECT name, uploaded_at AS at, total, relevant, added FROM uploads WHERE user_id = ? ORDER BY id DESC LIMIT 1',
        args: [userId],
      });
      return r.rows[0] ? { ...r.rows[0] } : null;
    },

    async getPrices(userId) {
      const r = await client.execute({ sql: 'SELECT isin, price, updated_at, source, info FROM prices WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.isin, {
        price: x.price, at: x.updated_at, source: x.source, info: x.info ? JSON.parse(x.info) : null,
      }]));
    },

    /** Precios escritos a mano. prices: { ISIN: número | null }; null borra el precio. */
    async setPrices(userId, prices) {
      const at = now();
      const stmts = Object.entries(prices).map(([isin, price]) =>
        price
          ? {
              sql: `INSERT INTO prices (user_id, isin, price, updated_at, source, info) VALUES (?, ?, ?, ?, 'manual', NULL)
                    ON CONFLICT(user_id, isin) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at,
                      source = 'manual', info = NULL`,
              args: [userId, isin, price, at],
            }
          : { sql: 'DELETE FROM prices WHERE user_id = ? AND isin = ?', args: [userId, isin] },
      );
      if (stmts.length) await client.batch(stmts, 'write');
      return at;
    },

    /** Cotizaciones en vivo: { ISIN: { price, info } }. Nunca pisan un precio manual. */
    async setLivePrices(userId, quotes) {
      const at = now();
      const stmts = Object.entries(quotes).map(([isin, q]) => ({
        sql: `INSERT INTO prices (user_id, isin, price, updated_at, source, info) VALUES (?, ?, ?, ?, 'live', ?)
              ON CONFLICT(user_id, isin) DO UPDATE SET price = excluded.price, updated_at = excluded.updated_at,
                info = excluded.info WHERE prices.source = 'live'`,
        args: [userId, isin, q.price, at, JSON.stringify(q.info)],
      }));
      if (stmts.length) await client.batch(stmts, 'write');
      return at;
    },

    /** Símbolos ya resueltos: { ISIN: { symbol, exchange, sector, industry } | null }. Los ausentes hay que buscarlos. */
    async getSymbols() {
      const r = await client.execute({ sql: 'SELECT isin, symbol, exchange, sector, industry, resolved_at FROM symbols WHERE v >= ?', args: [SYMBOL_V] });
      const out = {};
      for (const x of r.rows) {
        if (x.symbol) out[x.isin] = { symbol: x.symbol, exchange: x.exchange ?? '', sector: x.sector, industry: x.industry };
        else if (Date.now() - Date.parse(x.resolved_at) < RETRY_UNKNOWN_MS) out[x.isin] = null;
      }
      return out;
    },

    async saveSymbols(resolved) {
      const at = now();
      const stmts = Object.entries(resolved).map(([isin, s]) => ({
        sql: `INSERT INTO symbols (isin, symbol, exchange, sector, industry, resolved_at, v) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(isin) DO UPDATE SET symbol = excluded.symbol, exchange = excluded.exchange, sector = excluded.sector,
                industry = excluded.industry, resolved_at = excluded.resolved_at, v = excluded.v`,
        args: [isin, s?.symbol ?? null, s?.exchange ?? null, s?.sector ?? null, s?.industry ?? null, at, SYMBOL_V],
      }));
      if (stmts.length) await client.batch(stmts, 'write');
    },

    // ---------- alertas y objetivos ----------
    async getAlerts(userId) {
      const r = await client.execute({ sql: 'SELECT id, isin, dir, price, created_at, triggered_at FROM alerts WHERE user_id = ? ORDER BY id DESC', args: [userId] });
      return r.rows.map((x) => ({ ...x, id: Number(x.id) }));
    },
    async addAlert(userId, { isin, dir, price }) {
      await client.execute({ sql: 'INSERT INTO alerts (user_id, isin, dir, price, created_at) VALUES (?, ?, ?, ?, ?)', args: [userId, isin, dir, price, now()] });
    },
    async deleteAlert(userId, id) {
      await client.execute({ sql: 'DELETE FROM alerts WHERE user_id = ? AND id = ?', args: [userId, id] });
    },
    async triggerAlerts(userId, ids) {
      if (!ids.length) return;
      const at = now();
      await client.batch(ids.map((id) => ({ sql: 'UPDATE alerts SET triggered_at = ? WHERE user_id = ? AND id = ?', args: [at, userId, id] })), 'write');
    },
    async getTargets(userId) {
      const r = await client.execute({ sql: 'SELECT isin, weight FROM targets WHERE user_id = ?', args: [userId] });
      return Object.fromEntries(r.rows.map((x) => [x.isin, x.weight]));
    },
    /** targets: { ISIN: peso % | null }; null lo quita. */
    async setTargets(userId, targets) {
      const stmts = Object.entries(targets).map(([isin, w]) => (w > 0
        ? { sql: 'INSERT INTO targets (user_id, isin, weight) VALUES (?, ?, ?) ON CONFLICT(user_id, isin) DO UPDATE SET weight = excluded.weight', args: [userId, isin, w] }
        : { sql: 'DELETE FROM targets WHERE user_id = ? AND isin = ?', args: [userId, isin] }));
      if (stmts.length) await client.batch(stmts, 'write');
    },

    // ---------- logotipos ----------
    /** undefined = nunca buscado; null = no existe; { type, data } = guardado. */
    async getLogo(isin) {
      const r = await client.execute({ sql: 'SELECT type, data, fetched_at FROM logos WHERE isin = ?', args: [isin] });
      const x = r.rows[0];
      if (!x) return undefined;
      if (!x.data) return Date.now() - Date.parse(x.fetched_at) < 30 * 86400000 ? null : undefined;
      return { type: x.type, data: Buffer.from(x.data) };
    },
    async saveLogo(isin, logo) {
      await client.execute({
        sql: 'INSERT OR REPLACE INTO logos (isin, type, data, fetched_at) VALUES (?, ?, ?, ?)',
        args: [isin, logo?.type ?? null, logo?.data ?? null, now()],
      });
    },

    // ---------- histórico ----------
    async getHistoryMeta() {
      const r = await client.execute('SELECT symbol, currency, from_d, last_d, fetched_at, v FROM history_meta');
      return Object.fromEntries(r.rows.map((x) => [x.symbol, { ...x }]));
    },

    /** Guarda cierres, dividendos y splits de un símbolo (por lotes) y actualiza su estado. */
    async saveHistory(symbol, { currency, from, rows, divs = [], splits = [] }) {
      const stmts = [
        ...rows.map(([d, c]) => ({ sql: 'INSERT OR REPLACE INTO price_history (symbol, d, c) VALUES (?, ?, ?)', args: [symbol, d, c] })),
        ...divs.map(([d, a]) => ({ sql: 'INSERT OR REPLACE INTO symbol_divs (symbol, d, amount) VALUES (?, ?, ?)', args: [symbol, d, a] })),
        ...splits.map(([d, r]) => ({ sql: 'INSERT OR REPLACE INTO symbol_splits (symbol, d, ratio) VALUES (?, ?, ?)', args: [symbol, d, r] })),
      ];
      for (let i = 0; i < stmts.length; i += 400) await client.batch(stmts.slice(i, i + 400), 'write');
      await client.execute({
        sql: `INSERT INTO history_meta (symbol, currency, from_d, last_d, fetched_at, v) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT(symbol) DO UPDATE SET currency = excluded.currency, from_d = min(history_meta.from_d, excluded.from_d),
                last_d = max(coalesce(history_meta.last_d, ''), coalesce(excluded.last_d, '')), fetched_at = excluded.fetched_at, v = excluded.v`,
        args: [symbol, currency, from, rows.at(-1)?.[0] ?? null, now(), HISTORY_V],
      });
    },

    /** { símbolo: [[fecha, cierre], …] } ordenado por fecha. */
    async getHistory(symbols) {
      const out = Object.fromEntries(symbols.map((s) => [s, []]));
      for (let i = 0; i < symbols.length; i += 40) {
        const part = symbols.slice(i, i + 40);
        const r = await client.execute({
          sql: `SELECT symbol, d, c FROM price_history WHERE symbol IN (${part.map(() => '?').join(',')}) ORDER BY symbol, d`,
          args: part,
        });
        for (const x of r.rows) out[x.symbol].push([x.d, x.c]);
      }
      return out;
    },

    /** Todos los splits conocidos: { símbolo: [[fecha, ratio], …] } ordenado por fecha. */
    async getSplits() {
      const r = await client.execute('SELECT symbol, d, ratio FROM symbol_splits ORDER BY symbol, d');
      const out = {};
      for (const x of r.rows) (out[x.symbol] ??= []).push([x.d, x.ratio]);
      return out;
    },

    async getSymbolDivs(symbols) {
      if (!symbols.length) return {};
      const r = await client.execute({
        sql: `SELECT symbol, d, amount FROM symbol_divs WHERE symbol IN (${symbols.map(() => '?').join(',')}) ORDER BY symbol, d`,
        args: symbols,
      });
      const out = {};
      for (const x of r.rows) (out[x.symbol] ??= []).push([x.d, x.amount]);
      return out;
    },

    // ---------- valoraciones manuales con fecha ----------
    async getValuations(userId) {
      const r = await client.execute({ sql: 'SELECT isin, d, price FROM valuations WHERE user_id = ? ORDER BY isin, d', args: [userId] });
      const out = {};
      for (const x of r.rows) (out[x.isin] ??= []).push({ d: x.d, price: x.price });
      return out;
    },
    async setValuation(userId, isin, d, price) {
      await client.execute({
        sql: `INSERT INTO valuations (user_id, isin, d, price) VALUES (?, ?, ?, ?)
              ON CONFLICT(user_id, isin, d) DO UPDATE SET price = excluded.price`,
        args: [userId, isin, d, price],
      });
    },
    async deleteValuation(userId, isin, d) {
      await client.execute({ sql: 'DELETE FROM valuations WHERE user_id = ? AND isin = ? AND d = ?', args: [userId, isin, d] });
    },

    async clearUserData(userId) {
      await client.batch(
        ['transactions', 'prices', 'uploads', 'valuations', 'removed', 'alerts', 'targets'].map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] })),
        'write',
      );
    },
  };
}
