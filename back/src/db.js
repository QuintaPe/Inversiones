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
  `CREATE TABLE IF NOT EXISTS valuations (
     user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     isin TEXT NOT NULL, d TEXT NOT NULL, price REAL NOT NULL, PRIMARY KEY (user_id, isin, d))`,
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
];
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
    async saveUpload(userId, { name, total, rows, replace }) {
      const existing = replace
        ? new Set()
        : new Set((await client.execute({ sql: 'SELECT transaction_id FROM transactions WHERE user_id = ?', args: [userId] }))
            .rows.map((x) => x.transaction_id));
      const added = rows.filter((r) => !existing.has(r.transaction_id)).length;
      const info = { name, at: now(), total, relevant: rows.length, added };
      const sql = `INSERT OR REPLACE INTO transactions (user_id, ${ROW_COLS.join(', ')})
                   VALUES (?, ${ROW_COLS.map(() => '?').join(', ')})`;
      await client.batch(
        [
          ...(replace ? [{ sql: 'DELETE FROM transactions WHERE user_id = ?', args: [userId] }] : []),
          ...rows.map((r) => ({ sql, args: [userId, ...ROW_COLS.map((c) => r[c] ?? '')] })),
          {
            sql: 'INSERT INTO uploads (user_id, name, uploaded_at, total, relevant, added) VALUES (?, ?, ?, ?, ?, ?)',
            args: [userId, info.name, info.at, total, rows.length, added],
          },
        ],
        'write',
      );
      return info;
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

    // ---------- histórico ----------
    async getHistoryMeta() {
      const r = await client.execute('SELECT symbol, currency, from_d, last_d, fetched_at FROM history_meta');
      return Object.fromEntries(r.rows.map((x) => [x.symbol, { ...x }]));
    },

    /** Guarda cierres y dividendos de un símbolo (por lotes) y actualiza su estado. */
    async saveHistory(symbol, { currency, from, rows, divs = [] }) {
      const stmts = [
        ...rows.map(([d, c]) => ({ sql: 'INSERT OR REPLACE INTO price_history (symbol, d, c) VALUES (?, ?, ?)', args: [symbol, d, c] })),
        ...divs.map(([d, a]) => ({ sql: 'INSERT OR REPLACE INTO symbol_divs (symbol, d, amount) VALUES (?, ?, ?)', args: [symbol, d, a] })),
      ];
      for (let i = 0; i < stmts.length; i += 400) await client.batch(stmts.slice(i, i + 400), 'write');
      await client.execute({
        sql: `INSERT INTO history_meta (symbol, currency, from_d, last_d, fetched_at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(symbol) DO UPDATE SET currency = excluded.currency, from_d = min(history_meta.from_d, excluded.from_d),
                last_d = max(coalesce(history_meta.last_d, ''), coalesce(excluded.last_d, '')), fetched_at = excluded.fetched_at`,
        args: [symbol, currency, from, rows.at(-1)?.[0] ?? null, now()],
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
        ['transactions', 'prices', 'uploads', 'valuations'].map((t) => ({ sql: `DELETE FROM ${t} WHERE user_id = ?`, args: [userId] })),
        'write',
      );
    },
  };
}
