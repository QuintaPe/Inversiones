// Tareas programadas del servidor, todas en un sitio: cada una se ejecuta cada cierto tiempo,
// nunca solapada consigo misma, y deja apuntado cuándo corrió y cómo acabó (GET /api/status).

const DAY = 86_400_000;

/** Minutos que la zona horaria va por delante de UTC en un instante (con el horario de verano). */
function offsetMin(t, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(new Date(t)).map((x) => [x.type, Number(x.value)]));
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - Math.floor(t / 60_000) * 60_000) / 60_000);
}

/** Próximo instante (ms) en que son las `hour`:00 en `tz`, estrictamente después de `t`. */
export function nextDaily(t, hour, tz) {
  const local = new Date(t + offsetMin(t, tz) * 60_000); // la hora de pared, leída como UTC
  for (let k = 0; k < 3; k++) {
    const wall = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + k, hour);
    let at = wall - offsetMin(wall, tz) * 60_000;
    at = wall - offsetMin(at, tz) * 60_000; // el desfase de ese día (cambio de hora)
    if (at > t) return at;
  }
  return t + DAY;
}

/**
 * @param log  registro (log.js)
 * @param now  reloj, para las pruebas
 */
export function createJobs({ log = console, now = () => Date.now() } = {}) {
  const jobs = new Map(); // nombre → { everyMs, fn, timer, running, runs, lastAt, lastMs, lastError }

  async function run(name) {
    const j = jobs.get(name);
    if (!j || j.running) return undefined;
    j.running = true;
    const t0 = now();
    try {
      const out = await j.fn();
      j.lastError = null;
      return out;
    } catch (err) {
      j.lastError = err?.message ?? String(err);
      log.error(`Tarea «${name}»:`, j.lastError);
      return undefined;
    } finally {
      j.running = false; j.runs++; j.lastAt = new Date(t0).toISOString(); j.lastMs = now() - t0;
    }
  }

  return {
    /**
     * Programa `fn` cada `everyMs` milisegundos. Con `atStart`, además, nada más arrancar.
     * Un fallo se registra y no detiene las siguientes pasadas.
     */
    add(name, everyMs, fn, { atStart = false } = {}) {
      if (jobs.has(name)) throw new Error(`Tarea repetida: ${name}`);
      const timer = setInterval(() => run(name), everyMs);
      timer.unref?.();
      jobs.set(name, { everyMs, fn, timer, running: false, runs: 0, lastAt: null, lastMs: null, lastError: null });
      if (atStart) run(name);
    },
    /**
     * Programa `fn` una vez al día, a las `hour`:00 de la zona `tz`. Cada vez se calcula la
     * siguiente, así que respeta los cambios de hora.
     */
    daily(name, { hour, tz = 'Europe/Madrid' }, fn) {
      if (jobs.has(name)) throw new Error(`Tarea repetida: ${name}`);
      const j = { everyMs: DAY, fn, timer: null, running: false, runs: 0, lastAt: null, lastMs: null, lastError: null, nextAt: null };
      jobs.set(name, j);
      const schedule = () => {
        const at = nextDaily(now(), hour, tz);
        j.nextAt = new Date(at).toISOString();
        j.timer = setTimeout(async () => { await run(name); if (jobs.get(name) === j) schedule(); }, at - now());
        j.timer.unref?.();
      };
      schedule();
    },
    /** Ejecuta una tarea ahora (si no está ya en marcha). */
    run,
    /** Estado de cada tarea: [{ name, everySec, running, runs, lastAt, lastMs, lastError }]. */
    status: () => [...jobs].map(([name, j]) => ({ name, everySec: Math.round(j.everyMs / 1000), running: j.running, runs: j.runs, lastAt: j.lastAt, lastMs: j.lastMs, lastError: j.lastError, ...(j.nextAt ? { nextAt: j.nextAt } : {}) })),
    stop() {
      for (const j of jobs.values()) { clearInterval(j.timer); clearTimeout(j.timer); }
      jobs.clear();
    },
  };
}
