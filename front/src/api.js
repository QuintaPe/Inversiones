export class Unauthorized extends Error {}

async function call(url, opts) {
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...opts });
  } catch {
    throw new Error('No se pudo conectar con el servidor.');
  }
  // El service worker marca las respuestas que salen de su copia guardada.
  if (res.headers.get('X-Offline-Cache')) window.dispatchEvent(new Event('offline-data'));
  else if (res.ok && opts?.method === undefined) window.dispatchEvent(new Event('online-data'));
  const body = await res.json().catch(() => null);
  if (res.status === 401) throw new Unauthorized(body?.error || 'Inicia sesión para continuar.');
  if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
  return body;
}
const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const getConfig = () => call('/api/config');
export const getMe = () => call('/api/me');
export const loginGoogle = (credential) => call('/api/auth/google', json('POST', { credential }));
export const logout = () => call('/api/auth/logout', { method: 'POST' });
export const logoutOthers = () => call('/api/auth/logout-others', { method: 'POST' });
export const loginDemo = () => call('/api/auth/demo', { method: 'POST' });

// Los eventos y lotes de cada posición llegan aparte (/api/events) y solo cuando cambia su
// huella (meta.ev): las cotizaciones y demás cambios no los vuelven a traer.
let events = { tag: null, data: null };
let eventsLoad = null; // { tag, promise }
async function loadEvents(tag) {
  if (events.tag === tag) return events.data;
  if (eventsLoad?.tag === tag) return eventsLoad.promise;
  const promise = (async () => {
    let res;
    try {
      // Con su ETag, el navegador revalida la copia que ya tiene y casi siempre recibe un 304.
      res = await fetch('/api/events', { credentials: 'same-origin' });
    } catch {
      throw new Error('No se pudo conectar con el servidor.');
    }
    const body = await res.json().catch(() => null);
    if (res.status === 401) throw new Unauthorized(body?.error || 'Inicia sesión para continuar.');
    if (!res.ok) throw new Error(body?.error || `Error ${res.status}`);
    // La huella es la de lo recibido, aunque haya cambiado desde que se pidió.
    events = { tag: res.headers.get('ETag') ?? tag, data: body };
    return body;
  })().finally(() => { if (eventsLoad?.promise === promise) eventsLoad = null; });
  eventsLoad = { tag, promise };
  return promise;
}
/** Olvida los eventos guardados (al cerrar sesión). */
export const resetEvents = () => { events = { tag: null, data: null }; eventsLoad = null; };
/** Vuelve a poner en cada posición sus eventos y lotes. */
async function withEvents(res) {
  if (!res?.positions || !res.meta?.ev) return res;
  const ev = await loadEvents(res.meta.ev);
  return { ...res, positions: res.positions.map((p) => ({ ...p, evs: ev.evs[p.isin] ?? [], lots: ev.lots[p.isin] ?? [] })) };
}
const full = (promise) => promise.then(withEvents);

export const getPortfolio = () => full(call('/api/portfolio'));

const csvForm = (file) => { const fd = new FormData(); fd.append('file', file); return { method: 'POST', body: fd }; };
export const uploadCsv = (file, replace = false) => full(call(`/api/upload${replace ? '?replace=1' : ''}`, csvForm(file)));
/** Qué cambiaría al importar el archivo, sin guardar nada. */
export const previewCsv = (file) => call('/api/upload?preview=1', csvForm(file));
export const EXPORT_URL = '/api/export';
/** Qué trae una copia descargada (sin cambiar nada) y restaurarla: sustituye todos los datos. */
export const previewBackup = (file) => call('/api/import?preview=1', csvForm(file));
export const restoreBackup = (file) => full(call('/api/import', csvForm(file)));

export const pushSubscribe = (sub) => call('/api/push/subscribe', json('POST', sub));
export const pushUnsubscribe = (endpoint) => call('/api/push/unsubscribe', json('POST', { endpoint }));
export const pushTest = () => call('/api/push/test', { method: 'POST' });

export const setPrice = (isin, price) => call(`/api/prices/${encodeURIComponent(isin)}`, json('PUT', { price }));

export const refreshQuotes = () => full(call('/api/quotes/refresh', { method: 'POST' }));

export const getHistory = () => call('/api/history');
export const getAssetHistory = (isin, from) => call(`/api/assets/${encodeURIComponent(isin)}/history?from=${from}&bench=world`);
export const getDividendForecast = () => call('/api/dividends/forecast');
export const getSparks = () => call('/api/sparks');
export const getValuations = () => call('/api/valuations');
export const setValuation = (isin, d, price) => call(`/api/valuations/${encodeURIComponent(isin)}/${d}`, json('PUT', { price }));
export const deleteValuation = (isin, d) => call(`/api/valuations/${encodeURIComponent(isin)}/${d}`, { method: 'DELETE' });

export const addTx = (op) => full(call('/api/transactions', json('POST', op)));
export const editTx = (tid, op) => full(call(`/api/transactions/${encodeURIComponent(tid)}`, json('PUT', op)));
export const deleteTx = (tid) => full(call(`/api/transactions/${encodeURIComponent(tid)}`, { method: 'DELETE' }));
export const getRemoved = () => call('/api/transactions/removed');
export const restoreTx = (tid) => full(call(`/api/transactions/${encodeURIComponent(tid)}/restore`, { method: 'POST' }));
export const getCash = () => call('/api/cash');
/** Categoría de un comercio para todos sus pagos (category null = la automática). */
export const setCategory = (merchant, category) => call('/api/categories', json('PUT', { merchant, category }));

export const addAlert = (alert) => call('/api/alerts', json('POST', alert));
export const deleteAlert = (id) => call(`/api/alerts/${id}`, { method: 'DELETE' });
export const setTargets = (targets) => call('/api/targets', json('PUT', { targets }));

export const clearData = () => full(call('/api/data', { method: 'DELETE' }));
