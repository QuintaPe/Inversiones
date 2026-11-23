// Operaciones añadidas, editadas, quitadas y restauradas a mano.
import crypto from 'node:crypto';
import { manualRow } from '../engine.js';
import { isDate } from '../lib/validate.js';

const TYPES = new Set(['BUY', 'SELL', 'DIVIDEND']);
const posNum = (v) => { const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : NaN; };
function readOp(body) {
  const op = {
    type: body?.type, isin: String(body?.isin ?? '').trim().toUpperCase(), name: String(body?.name ?? '').trim(),
    date: body?.date, asset_class: body?.asset_class, cash: body?.cash !== false,
    shares: posNum(body?.shares), price: posNum(body?.price), fee: posNum(body?.fee || 0), tax: posNum(body?.tax || 0), amount: posNum(body?.amount || 0),
  };
  if (!TYPES.has(op.type)) return 'Tipo de operación no válido.';
  if (!op.isin || op.isin.length > 20 || !op.name || op.name.length > 80) return 'Indica el nombre y el ISIN del activo.';
  if (!isDate(op.date) || op.date > new Date().toISOString().slice(0, 10)) return 'La fecha no es válida.';
  if ([op.fee, op.tax].some(Number.isNaN)) return 'Comisión o impuesto no válidos.';
  if (op.type === 'DIVIDEND') return op.amount > 0 ? op : 'Indica el importe bruto del dividendo.';
  return op.shares > 0 && op.price > 0 ? op : 'Indica cantidad y precio.';
}

export default function transactionRoutes(api, { db, pf }) {
  const { portfolio, oversold } = pf;

  api.post('/transactions', async (req, res) => {
    const op = readOp(req.body);
    if (typeof op === 'string') return res.status(400).json({ error: op });
    const row = manualRow(op, `manual-${crypto.randomUUID()}`);
    const bad = await oversold([...(await db.getRows(req.userId)), row]);
    if (bad) return res.status(400).json({ error: `Con esta operación venderías más ${bad.name} de lo que tenías en esa fecha.` });
    await db.putRow(req.userId, row);
    res.json(await portfolio(req.userId));
  });

  api.put('/transactions/:tid', async (req, res) => {
    if (!req.params.tid.startsWith('manual-')) return res.status(400).json({ error: 'Solo se pueden editar las operaciones añadidas a mano.' });
    if (!(await db.getRow(req.userId, req.params.tid))) return res.status(404).json({ error: 'Operación no encontrada.' });
    const op = readOp(req.body);
    if (typeof op === 'string') return res.status(400).json({ error: op });
    const row = manualRow(op, req.params.tid);
    const bad = await oversold([...(await db.getRows(req.userId)).filter((r) => r.transaction_id !== row.transaction_id), row]);
    if (bad) return res.status(400).json({ error: `Con este cambio venderías más ${bad.name} de lo que tenías en esa fecha.` });
    await db.putRow(req.userId, row);
    res.json(await portfolio(req.userId));
  });

  api.delete('/transactions/:tid', async (req, res) => {
    const row = await db.getRow(req.userId, req.params.tid);
    if (!row) return res.status(404).json({ error: 'Operación no encontrada.' });
    const bad = await oversold((await db.getRows(req.userId)).filter((r) => r.transaction_id !== row.transaction_id));
    if (bad) return res.status(400).json({ error: `No se puede quitar: dejaría ventas de ${bad.name} sin las compras que las cubren.` });
    await db.removeRow(req.userId, row, !row.transaction_id.startsWith('manual-'));
    res.json(await portfolio(req.userId));
  });

  api.get('/transactions/removed', async (req, res) => res.json({ removed: await db.getRemoved(req.userId) }));
  api.post('/transactions/:tid/restore', async (req, res) => {
    if (!(await db.restoreRow(req.userId, req.params.tid))) return res.status(404).json({ error: 'Operación no encontrada.' });
    res.json(await portfolio(req.userId));
  });
}
