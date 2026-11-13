// Quita (borrado lógico, restaurable desde «Operaciones quitadas») las operaciones de inversión
// anteriores a CUTOFF del usuario real, si no deja ventas posteriores sin cubrir.
import { createClient } from '@libsql/client';
import { openDb } from '../src/db.js';
import { buildPortfolio, isInvestRow } from '../src/engine.js';

const CUTOFF = process.env.CUTOFF; // AAAA-MM-DD
if (!/^\d{4}-\d{2}-\d{2}$/.test(CUTOFF ?? '')) { console.log('Uso: CUTOFF=AAAA-MM-DD node --env-file=.env scripts/quitar-anteriores.mjs [--aplicar]'); process.exit(1); }
const raw = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
const users = (await raw.execute("SELECT id FROM users WHERE id NOT LIKE 'demo-%'")).rows.map((r) => r.id);
if (users.length !== 1) { console.log('Usuarios reales:', users.length, '— me detengo, no sé cuál es el tuyo.'); process.exit(1); }
const userId = users[0];
const db = await openDb();
const rows = await db.getRows(userId);
const target = rows.filter((r) => isInvestRow(r) && r.date < CUTOFF);
console.log(`Operaciones de inversión antes del ${CUTOFF}: ${target.length}`);
for (const r of target) console.log(`  ${r.date}  ${r.type.padEnd(18)} ${(r.name ?? '').slice(0, 38).padEnd(38)} ${r.amount}`);

const [bySymbol, known] = await Promise.all([db.getSplits(), db.getSymbols()]);
const splits = {};
for (const [isin, s] of Object.entries(known)) if (s?.symbol && bySymbol[s.symbol]) splits[isin] = bySymbol[s.symbol];
const ids = new Set(target.map((r) => r.transaction_id));
const bad = buildPortfolio(rows.filter((r) => !ids.has(r.transaction_id)), splits).positions
  .find((p) => p.sh < -1e-6 || p.evs.some((e) => e.sa < -1e-6));
if (bad) { console.log(`\nNO SE QUITA NADA: dejaría ventas de ${bad.name} sin las compras que las cubren.`); process.exit(2); }
if (process.argv[2] !== '--aplicar') { console.log('\n(Simulación: no se ha cambiado nada.)'); process.exit(0); }
for (const r of target) await db.removeRow(userId, r, !r.transaction_id.startsWith('manual-'));
await raw.execute({ sql: 'DELETE FROM history_cache WHERE user_id = ?', args: [userId] }); // que el histórico se recalcule
console.log(`\nQuitadas ${target.length} operaciones.`);
