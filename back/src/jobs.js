// Tareas programadas del servidor, todas en un sitio: cada una se ejecuta cada cierto tiempo,
// nunca solapada consigo misma, y deja apuntado cuándo corrió y cómo acabó (GET /api/status).

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
    /** Ejecuta una tarea ahora (si no está ya en marcha). */
    run,
    /** Estado de cada tarea: [{ name, everySec, running, runs, lastAt, lastMs, lastError }]. */
    status: () => [...jobs].map(([name, j]) => ({ name, everySec: Math.round(j.everyMs / 1000), running: j.running, runs: j.runs, lastAt: j.lastAt, lastMs: j.lastMs, lastError: j.lastError })),
    stop() {
      for (const j of jobs.values()) clearInterval(j.timer);
      jobs.clear();
    },
  };
}
