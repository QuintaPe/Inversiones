// Medición por petición: cuánto tiempo se va en la base de datos, en el cálculo y en
// los proveedores externos (Yahoo, onvista…). Sale en la cabecera Server-Timing, que
// se ve en la pestaña Red del navegador, y en el registro si la petición es lenta.
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

const als = new AsyncLocalStorage();
const KINDS = { db: 'Base de datos', calc: 'Cálculo', ext: 'Proveedores externos' };

/** Ejecuta fn (síncrona o asíncrona) y suma su duración a `kind` en la petición en curso. */
export function measure(kind, fn) {
  const t = als.getStore();
  if (!t) return fn();
  const start = performance.now();
  const done = () => { t[kind].ms += performance.now() - start; t[kind].n++; };
  let out;
  try {
    out = fn();
  } catch (err) {
    done();
    throw err;
  }
  if (out && typeof out.then === 'function') return out.finally(done);
  done();
  return out;
}

/** Envuelve todos los métodos de un objeto para medirlos como `kind`. */
export function instrument(obj, kind, only = null) {
  if (!obj) return obj;
  const out = { ...obj };
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'function' && (!only || only.includes(k))) out[k] = (...args) => measure(kind, () => v.apply(obj, args));
  }
  return out;
}

const fmt = (t, total) => [
  ...Object.keys(KINDS).filter((k) => t[k].n).map((k) => `${k};dur=${t[k].ms.toFixed(1)};desc="${KINDS[k]} (${t[k].n})"`),
  `total;dur=${total.toFixed(1)}`,
].join(', ');

/**
 * Middleware: abre la cuenta de la petición y escribe Server-Timing al responder.
 * Los tiempos de la base de datos se suman aunque las consultas vayan en paralelo.
 * @param slowMs  registra en consola las peticiones que tarden más (0 = nunca)
 */
export function timing({ slowMs = 1000, log = console } = {}) {
  return (req, res, next) => {
    const t = { db: { ms: 0, n: 0 }, calc: { ms: 0, n: 0 }, ext: { ms: 0, n: 0 } };
    const start = performance.now();
    const writeHead = res.writeHead;
    res.writeHead = function (...args) {
      if (!this.headersSent && !String(this.getHeader('Content-Type') ?? '').startsWith('text/event-stream')) {
        this.setHeader('Server-Timing', fmt(t, performance.now() - start));
      }
      return writeHead.apply(this, args);
    };
    if (slowMs > 0) {
      res.on('finish', () => {
        const total = performance.now() - start;
        if (total >= slowMs) log.warn(`Lenta: ${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} · ${fmt(t, total)}`);
      });
    }
    als.run(t, next);
  };
}
