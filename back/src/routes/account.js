// Alertas, cartera objetivo, efectivo y categorías, copia de los datos, avisos y borrado.
import { buildCash, buildIncome, CASH_LABEL } from '../engine.js';
import multer from 'multer';
import { parsePrice } from '../lib/validate.js';
import { readBackup, backupSummary } from '../backup.js';

const backupFile = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export default function accountRoutes(api, { db, push, pf }) {
  const { portfolio } = pf;

  // ---------- alertas de precio y cartera objetivo ----------
  api.post('/alerts', async (req, res) => {
    const price = parsePrice(req.body?.price), dir = req.body?.dir, isin = String(req.body?.isin ?? '');
    if (!price || !['above', 'below'].includes(dir) || !isin) return res.status(400).json({ error: 'Alerta no válida.' });
    if ((await db.getAlerts(req.userId)).length >= 200) return res.status(400).json({ error: 'Has llegado al máximo de alertas.' });
    await db.addAlert(req.userId, { isin, dir, price });
    res.json({ alerts: await db.getAlerts(req.userId) });
  });
  api.delete('/alerts/:id', async (req, res) => {
    await db.deleteAlert(req.userId, Number(req.params.id));
    res.json({ alerts: await db.getAlerts(req.userId) });
  });
  api.put('/targets', async (req, res) => {
    const clean = {};
    for (const [isin, w] of Object.entries(req.body?.targets ?? {})) {
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
    res.json({ cash: buildCash(rows), labels: CASH_LABEL, income: buildIncome(rows), cats: await db.getMerchantCategories(req.userId) });
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
      .json({ app: 'cartera', version: 2, exported_at: new Date().toISOString(), ...(await db.exportUser(req.userId)) });
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

  api.delete('/data', async (req, res) => {
    await db.clearUserData(req.userId);
    res.json(await portfolio(req.userId));
  });
}
