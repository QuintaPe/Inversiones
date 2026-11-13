// Registro del servidor. En producción (o con LOG_FORMAT=json) cada línea es un objeto JSON
// con fecha, nivel y mensaje, que es lo que saben leer las plataformas de despliegue; en
// desarrollo, texto normal. Se usa como console: log.info('texto', dato, error…).

const text = (args) => args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a))).join(' ');

/** @param json  true: una línea JSON por mensaje; por defecto según LOG_FORMAT y NODE_ENV */
export function createLog({ json = process.env.LOG_FORMAT ? process.env.LOG_FORMAT === 'json' : process.env.NODE_ENV === 'production', out = console } = {}) {
  const write = (level) => (...args) => {
    if (!json) return out[level === 'info' ? 'log' : level](...args);
    const err = args.find((a) => a instanceof Error);
    // Los objetos sueltos son campos del registro: log.error('Fallo', { id, path }, err).
    const fields = Object.assign({}, ...args.filter((a) => a && typeof a === 'object' && !(a instanceof Error) && !Array.isArray(a)));
    const msg = text(args.filter((a) => typeof a !== 'object' || a instanceof Error || Array.isArray(a)));
    return out[level === 'info' ? 'log' : level](JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields, ...(err?.stack && { stack: err.stack }) }));
  };
  const info = write('info');
  return { info, log: info, warn: write('warn'), error: write('error') };
}
