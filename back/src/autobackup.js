// Copias automáticas: una vez al día se vuelca cada cuenta a un archivo comprimido, con el
// mismo formato que descarga GET /api/export (se restaura desde el menú de la cuenta tras
// descomprimirlo). Se conservan las últimas diarias y una por semana de las anteriores.
import fs from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const gzip = promisify(zlib.gzip);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
/** Lunes de la semana de un día AAAA-MM-DD: identifica la semana. */
const weekOf = (d) => {
  const t = Date.parse(`${d}T00:00:00Z`);
  return new Date(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY).toISOString().slice(0, 10);
};

/**
 * Qué carpetas de día se conservan: las `daily` más recientes y, de las anteriores, la
 * primera de cada una de las `weekly` semanas siguientes hacia atrás.
 * @param days  carpetas AAAA-MM-DD, en cualquier orden
 */
export function keepDays(days, daily = 14, weekly = 8) {
  const sorted = [...days].sort().reverse();
  const keep = new Set(sorted.slice(0, daily));
  const weeks = new Map(); // semana → su día más antiguo
  for (const d of sorted.slice(daily)) weeks.set(weekOf(d), d);
  for (const d of [...weeks.values()].slice(0, weekly)) keep.add(d);
  return keep;
}

/**
 * @param db     repositorio de db.js
 * @param dir    carpeta de las copias
 * @param skip   prefijo de las cuentas que no se copian (las de la cartera de ejemplo)
 */
export function createAutoBackup({ db, dir, daily = 14, weekly = 8, skip = 'demo-', log = console, now = () => Date.now() }) {
  let running = null;
  let last = null; // { at, day, users, error }

  async function once() {
    const at = new Date(now()).toISOString();
    const day = at.slice(0, 10);
    const out = path.join(dir, day);
    await fs.mkdir(out, { recursive: true, mode: 0o700 });
    let users = 0;
    for (const id of await db.listUserIds()) {
      if (id.startsWith(skip)) continue;
      const data = await db.exportUser(id);
      if (!data.transactions.length) continue; // cuenta vacía: nada que perder
      const body = await gzip(JSON.stringify({ app: 'cartera', version: 3, exported_at: at, ...data }));
      // Se escribe aparte y se renombra: una copia a medias nunca pisa la buena del mismo día.
      const file = path.join(out, `${id.replace(/[^\w.-]/g, '_')}.json.gz`);
      await fs.writeFile(`${file}.tmp`, body, { mode: 0o600 });
      await fs.rename(`${file}.tmp`, file);
      users++;
    }
    if (!users) await fs.rmdir(out).catch(() => {});
    const days = (await fs.readdir(dir)).filter((d) => DAY_RE.test(d));
    const keep = keepDays(days, daily, weekly);
    for (const d of days) if (!keep.has(d)) await fs.rm(path.join(dir, d), { recursive: true, force: true });
    return { at, day, users };
  }

  /** Hace la copia de hoy (sustituye la que hubiera del mismo día). Las pasadas no se solapan. */
  function run() {
    running ??= once()
      .then((r) => { last = { ...r, error: null }; return r; })
      .catch((err) => { last = { at: new Date(now()).toISOString(), day: null, users: 0, error: err.message }; throw err; })
      .finally(() => { running = null; });
    return running;
  }

  return {
    run,
    /** ¿Falta la copia de hoy? (Un día sin cuentas que copiar no deja carpeta: se vuelve a mirar, y es barato.) */
    due: () => fs.access(path.join(dir, new Date(now()).toISOString().slice(0, 10))).then(() => false, () => true),
    /** Resultado de la última pasada, o null si aún no ha habido ninguna. */
    last: () => last,
    /** Copia al arrancar si falta la de hoy y después cada `hours` horas. Devuelve la función que lo detiene. */
    start(hours = 24) {
      const go = () => run()
        .then((r) => r.users && log.info(`Copia automática: ${r.users} ${r.users === 1 ? 'cuenta' : 'cuentas'} en ${path.join(dir, r.day)}.`))
        .catch((err) => log.error('Copia automática:', err.message));
      const today = new Date(now()).toISOString().slice(0, 10);
      fs.access(path.join(dir, today)).catch(go);
      const id = setInterval(go, hours * 3600_000);
      id.unref();
      return () => clearInterval(id);
    },
  };
}
