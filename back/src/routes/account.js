// Alertas, cartera objetivo, efectivo y categorías, copia de los datos, avisos y borrado.
import { buildCash, buildIncome, CASH_LABEL } from '../engine.js';
import multer from 'multer';
import { parsePrice, isAssetId, isDate, assetMap, check } from '../lib/validate.js';
import { readBackup, backupSummary, ACCOUNT_KINDS } from '../backup.js';
import { cleanSetting, SETTING_KEYS } from '../lib/settings.js';

const backupFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

const ISIN_RE = /^[A-Z]{2}[A-Z0-9]{9}\d$/;

export default function accountRoutes(api, { db, push, pf, quotes, digest }) {
  const { portfolio } = pf;

  // ---------- alertas de precio y cartera objetivo ----------
  api.post('/alerts', async (req, res) => {
    const price = parsePrice(req.body?.price), dir = req.body?.dir, isin = String(req.body?.isin ?? '');
    if (!price || !['above', 'below', 'move', 'drop'].includes(dir) || !isAssetId(isin) || ((dir === 'move' || dir === 'drop') && price > 100)) return res.status(400).json({ error: 'Alerta no válida.' });
    if ((await db.getAlerts(req.userId)).length >= 200) return res.status(400).json({ error: 'Has llegado al máximo de alertas.' });
    await db.addAlert(req.userId, { isin, dir, price });
    res.json({ alerts: await db.getAlerts(req.userId) });
  });
  api.delete('/alerts/:id', async (req, res) => {
    check(/^\d{1,15}$/.test(req.params.id), 'Alerta no válida.');
    await db.deleteAlert(req.userId, Number(req.params.id));
    res.json({ alerts: await db.getAlerts(req.userId) });
  });
  api.put('/targets', async (req, res) => {
    const clean = {};
    for (const [isin, w] of assetMap(req.body?.targets, 500, 'pesos')) {
      const n = w == null || w === '' ? null : Number(w);
      if (n != null && !(n >= 0 && n <= 100)) return res.status(400).json({ error: 'Los pesos van de 0 a 100.' });
      clean[isin] = n;
    }
    await db.setTargets(req.userId, clean);
    res.json({ targets: await db.getTargets(req.userId) });
  });

  // Saldo de efectivo reconstruido desde el CSV (null si el CSV se subió antes de guardar el efectivo).
  api.get('/cash', async (req, res) => {
    const rows = await db.getRows(req.userId);
    res.json({ cash: buildCash(rows), labels: CASH_LABEL, income: buildIncome(rows), cats: await db.getMerchantCategories(req.userId), budgets: await db.getBudgets(req.userId) });
  });

  // Categoría de un comercio, para todos sus pagos. { merchant, category } (category null = automática).
  api.put('/categories', async (req, res) => {
    const merchant = String(req.body?.merchant ?? '').trim().slice(0, 200);
    const category = req.body?.category == null ? null : String(req.body.category).trim().slice(0, 40);
    if (!merchant) return res.status(400).json({ error: 'Falta el comercio.' });
    if (category != null && !/^[a-z]+$/.test(category)) return res.status(400).json({ error: 'Categoría no válida.' });
    await db.setMerchantCategory(req.userId, merchant, category);
    res.json({ cats: await db.getMerchantCategories(req.userId) });
  });

  // ---------- importaciones, copia de los datos y avisos ----------
  api.get('/imports', async (req, res) => res.json({ imports: await db.getImports(req.userId) }));

  api.get('/export', async (req, res) => {
    const day = new Date().toISOString().slice(0, 10);
    res.set('Content-Disposition', `attachment; filename="cartera-${day}.json"`)
      .json({ app: 'cartera', version: 3, exported_at: new Date().toISOString(), ...(await db.exportUser(req.userId)) });
  });

  // ---------- valores en seguimiento y nota de cada activo ----------
  api.get('/watchlist', async (req, res) => res.json({ watch: await db.getWatch(req.userId) }));
  // Añade un valor por su ISIN: se busca su símbolo, se cotiza y se guarda con su nombre.
  api.post('/watchlist', async (req, res) => {
    const isin = String(req.body?.isin ?? '').trim().toUpperCase();
    check(ISIN_RE.test(isin), 'Escribe un ISIN válido (12 caracteres, como US0378331005).');
    check((await db.getWatch(req.userId)).length < 200, 'Has llegado al máximo de valores en seguimiento.');
    let name = String(req.body?.name ?? '').trim().slice(0, 80);
    if (quotes) {
      const { quotes: found, resolved, failed } = await quotes.quoteIsins([isin], await db.getSymbols());
      await db.saveSymbols(resolved);
      if (failed.length) return res.status(404).json({ error: 'No encuentro cotización para ese ISIN.' });
      await db.setLivePrices(found);
      name ||= (await quotes.nameOf?.(isin)) ?? '';
    }
    await db.addWatch(req.userId, { isin, name: name || (await db.getNames([isin]))[isin] || isin });
    res.json({ watch: await db.getWatch(req.userId) });
  });
  api.delete('/watchlist/:isin', async (req, res) => {
    await db.deleteWatch(req.userId, req.params.isin);
    res.json({ watch: await db.getWatch(req.userId) });
  });
  // Nota libre de un activo ({ note }; vacía la borra).
  api.put('/notes/:isin', async (req, res) => {
    const note = String(req.body?.note ?? '').trim();
    check(note.length <= 2000, 'La nota es demasiado larga (máximo 2.000 caracteres).');
    await db.setNote(req.userId, req.params.isin, note);
    res.json({ isin: req.params.isin, note: note || null });
  });

  // ---------- ajustes guardados en la cuenta: { value } (null lo quita) ----------
  api.put('/settings/:key', async (req, res) => {
    check(SETTING_KEYS.includes(req.params.key), 'Ajuste no válido.');
    const value = req.body?.value == null ? null : cleanSetting(req.params.key, req.body.value);
    check(value !== undefined, 'Valor no válido.');
    await db.setUserSetting(req.userId, req.params.key, value);
    res.json({ settings: await db.getUserSettings(req.userId) });
  });

  // ---------- patrimonio: otras cuentas, bienes y deudas, con saldos anotados a mano ----------
  const readAccount = (body) => {
    const name = String(body?.name ?? '').trim();
    check(name.length >= 1 && name.length <= 60, 'Escribe un nombre de hasta 60 caracteres.');
    check(ACCOUNT_KINDS.includes(body?.kind), 'Tipo de cuenta no válido.');
    return { name, kind: body.kind };
  };
  // Saldo: cero o positivo (en una deuda, lo que queda por pagar), en una fecha que no sea futura.
  const readBalance = (body) => {
    const amount = typeof body?.amount === 'number' ? body.amount : parseFloat(String(body?.amount ?? '').replace(',', '.'));
    check(Number.isFinite(amount) && amount >= 0 && amount <= 1e12, 'Importe no válido.');
    const d = body?.d ?? new Date().toISOString().slice(0, 10);
    check(isDate(d) && d >= '1970-01-01' && d <= new Date().toISOString().slice(0, 10), 'Fecha no válida.');
    return { d, amount };
  };
  const accountId = (req) => { check(/^[0-9a-f-]{36}$/.test(req.params.id), 'Cuenta no válida.'); return req.params.id; };
  const accounts = async (req, res) => res.json({ accounts: await db.getAccounts(req.userId) });

  api.get('/accounts', accounts);
  // Crea la cuenta con su primer saldo: { name, kind, amount, d? }.
  api.post('/accounts', async (req, res) => {
    const acc = readAccount(req.body), bal = readBalance(req.body);
    check((await db.getAccounts(req.userId)).length < 50, 'Has llegado al máximo de cuentas.');
    await db.setAccountBalance(req.userId, await db.addAccount(req.userId, acc), bal.d, bal.amount);
    return accounts(req, res);
  });
  api.put('/accounts/:id', async (req, res) => {
    if (!(await db.updateAccount(req.userId, accountId(req), readAccount(req.body)))) return res.status(404).json({ error: 'Cuenta no encontrada.' });
    return accounts(req, res);
  });
  api.delete('/accounts/:id', async (req, res) => {
    await db.deleteAccount(req.userId, accountId(req));
    return accounts(req, res);
  });
  // Anota el saldo de un día (el mismo día se corrige): { amount, d? }.
  api.put('/accounts/:id/balances', async (req, res) => {
    const id = accountId(req), bal = readBalance(req.body);
    const acc = (await db.getAccounts(req.userId)).find((a) => a.id === id);
    if (!acc) return res.status(404).json({ error: 'Cuenta no encontrada.' });
    check(acc.balances.length < 1000 || acc.balances.some((b) => b.d === bal.d), 'Demasiados saldos anotados en esta cuenta.');
    await db.setAccountBalance(req.userId, id, bal.d, bal.amount);
    return accounts(req, res);
  });
  api.delete('/accounts/:id/balances/:d', async (req, res) => {
    await db.deleteAccountBalance(req.userId, accountId(req), req.params.d);
    return accounts(req, res);
  });

  // Tope de gasto al mes de una categoría ('total' = todo el gasto). { category, amount } (amount vacío lo quita).
  api.put('/budgets', async (req, res) => {
    const category = String(req.body?.category ?? '');
    check(/^[a-z]{1,40}$/.test(category), 'Categoría no válida.');
    const clear = req.body?.amount == null || req.body.amount === '';
    const amount = clear ? null : parsePrice(req.body.amount);
    check(clear || (amount && amount <= 1e9), 'Importe no válido.');
    await db.setBudget(req.userId, category, amount);
    res.json({ budgets: await db.getBudgets(req.userId) });
  });

  // Restaura una copia descargada con /export: sustituye todos los datos de la cuenta.
  // ?preview=1 solo cuenta qué trae la copia y qué hay ahora, sin cambiar nada.
  api.post('/import', backupFile.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se ha recibido ningún archivo.' });
    const backup = readBackup(req.file.buffer.toString('utf8'));
    if (req.query.preview === '1') {
      const now = await db.exportUser(req.userId);
      return res.json({ preview: { ...backupSummary(backup), current: now.transactions.filter((t) => !t.deleted_at).length } });
    }
    await db.restoreUser(req.userId, backup);
    res.json({ restored: backupSummary(backup), ...(await portfolio(req.userId)) });
  });

  api.post('/push/subscribe', async (req, res) => {
    if (!push) return res.status(503).json({ error: 'Los avisos están desactivados en el servidor.' });
    const { endpoint, keys } = req.body ?? {};
    const ok = typeof endpoint === 'string' && /^https:\/\//.test(endpoint) && endpoint.length < 1000
      && typeof keys?.p256dh === 'string' && typeof keys?.auth === 'string' && keys.p256dh.length < 200 && keys.auth.length < 100;
    if (!ok) return res.status(400).json({ error: 'Suscripción no válida.' });
    if ((await db.getPushSubs(req.userId)).length >= 20) return res.status(400).json({ error: 'Demasiados dispositivos con avisos.' });
    await db.addPushSub(req.userId, { endpoint, p256dh: keys.p256dh, auth: keys.auth });
    res.json({ ok: true });
  });
  api.post('/push/unsubscribe', async (req, res) => {
    if (typeof req.body?.endpoint === 'string') await db.deletePushSub(req.body.endpoint, req.userId);
    res.json({ ok: true });
  });
  api.post('/push/test', async (req, res) => {
    if (!push) return res.status(503).json({ error: 'Los avisos están desactivados en el servidor.' });
    const sent = await push.notify(req.userId, { title: 'Avisos activados', body: 'Te avisaremos aquí cuando salte una alerta de precio.', url: '/', tag: 'test' });
    res.json({ sent });
  });

  // Envía ahora el resumen periódico a los dispositivos del usuario, para ver cómo es.
  api.post('/digest/test', async (req, res) => {
    if (!push) return res.status(503).json({ error: 'Los avisos están desactivados en el servidor.' });
    const every = req.body?.every === 'month' ? 'month' : 'week';
    const r = await digest.send(req.userId, every);
    if (!r) return res.status(400).json({ error: 'Todavía no hay posiciones con precio que resumir.' });
    res.json({ sent: r.sent, title: r.title, body: r.body });
  });

  api.delete('/data', async (req, res) => {
    await db.clearUserData(req.userId);
    res.json(await portfolio(req.userId));
  });
}
