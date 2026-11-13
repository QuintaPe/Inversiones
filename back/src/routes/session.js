// Sesión: configuración pública, acceso con Google, cartera de ejemplo y cierre.
import crypto from 'node:crypto';
import { AuthError } from '../auth.js';
import { demoRows, DEMO_PREFIX, DEMO_TTL_DAYS } from '../demo.js';

/** Se montan en la app (no en el router con sesión). Devuelve { cleanDemo }. */
export default function sessionRoutes(app, { db, session, verifyGoogle, googleClientId, push, demo, forget }) {
  app.get('/api/config', (_req, res) => res.json({ googleClientId: googleClientId ?? null, pushKey: push?.publicKey ?? null, demo }));

  app.post('/api/auth/google', async (req, res) => {
    if (!verifyGoogle) throw new AuthError('El servidor no tiene configurado GOOGLE_CLIENT_ID.');
    const credential = req.body?.credential;
    if (typeof credential !== 'string' || !credential) throw new AuthError('Falta la credencial de Google.');
    const profile = await verifyGoogle(credential);
    await db.upsertUser(profile);
    session.issue(res, req, profile.id);
    res.json({ user: profile });
  });

  // Cartera de ejemplo: una cuenta temporal con datos inventados, sin Google.
  app.post('/api/auth/demo', async (req, res) => {
    if (!demo) return res.status(404).json({ error: 'La cartera de ejemplo está desactivada.' });
    const profile = { id: `${DEMO_PREFIX}${crypto.randomUUID()}`, email: 'ejemplo@cartera.local', name: 'Cartera de ejemplo' };
    await db.upsertUser(profile);
    const { rows, total, invest } = demoRows();
    await db.saveUpload(profile.id, { name: 'cartera-de-ejemplo.csv', total, rows, relevant: invest });
    session.issue(res, req, profile.id);
    res.json({ user: profile });
  });
  /** Borra las cuentas de ejemplo de más de DEMO_TTL_DAYS días. Devuelve cuántas. */
  async function cleanDemo() {
    const ids = await db.staleUsers(DEMO_PREFIX, new Date(Date.now() - DEMO_TTL_DAYS * 86400000).toISOString());
    await db.deleteUsers(ids);
    for (const id of ids) forget(id);
    return ids.length;
  }

  app.post('/api/auth/logout', (_req, res) => {
    session.clear(res);
    res.json({ ok: true });
  });

  app.get('/api/me', async (req, res) => {
    const id = session.read(req);
    res.json({ user: id ? await db.getUser(id) : null });
  });

  return { cleanDemo };
}
