// Cotizaciones empujadas desde el servidor (Server-Sent Events). En lugar de que cada
// pestaña pida sus precios cada minuto, el servidor cotiza una sola vez el conjunto de
// valores de todos los usuarios conectados y envía a cada uno los suyos.

const HEARTBEAT_MS = 25_000; // comentario vacío para que los proxies no corten la conexión
const MAX_PER_USER = 6;

/**
 * @param refresh  async (userIds) => Map(userId → datos a enviar); cotiza y guarda
 */
export function createStream({ refresh, log = console }) {
  const clients = new Map(); // usuario → Set(res)
  let running = null;

  const send = (res, event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  /** Abre el canal para una petición ya autenticada. */
  function connect(req, res, userId) {
    const set = clients.get(userId) ?? new Set();
    if (set.size >= MAX_PER_USER) return res.status(429).json({ error: 'Demasiadas pestañas abiertas.' });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // nginx: sin búfer
    });
    res.write('retry: 5000\n\n');
    set.add(res);
    clients.set(userId, set);
    const beat = setInterval(() => res.write(': \n\n'), HEARTBEAT_MS);
    beat.unref?.();
    req.on('close', () => {
      clearInterval(beat);
      set.delete(res);
      if (!set.size) clients.delete(userId);
    });
    return undefined;
  }

  /** Una pasada: cotiza para todos los conectados y envía. Las pasadas no se solapan. */
  async function tick() {
    if (running) return running;
    if (!clients.size) return 0;
    running = (async () => {
      const out = await refresh([...clients.keys()]);
      let n = 0;
      for (const [userId, data] of out) {
        for (const res of clients.get(userId) ?? []) { send(res, 'quotes', data); n++; }
      }
      return n;
    })().finally(() => { running = null; });
    return running;
  }

  return {
    connect, tick,
    /** Usuarios con alguna pestaña conectada. */
    connected: () => clients.size,
    /** Avisa a las pestañas de un usuario de que sus datos han cambiado (otra pestaña, otro dispositivo…). */
    changed(userId, data = {}) {
      for (const res of clients.get(userId) ?? []) send(res, 'changed', data);
    },
    /** Cotiza cada `seconds` segundos mientras haya alguien conectado. */
    start(seconds) {
      const id = setInterval(() => tick().catch((err) => log.error('Cotizaciones:', err.message)), seconds * 1000);
      id.unref();
      return () => clearInterval(id);
    },
    close() {
      for (const set of clients.values()) for (const res of set) res.end();
      clients.clear();
    },
  };
}
