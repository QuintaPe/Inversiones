export class Unauthorized extends Error {}

async function call(url, opts) {
  let res;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...opts });
  } catch {
    throw new Error('No se pudo conectar con el servidor.');
  }
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

export const getPortfolio = () => call('/api/portfolio');

export const uploadCsv = (file, replace = false) => {
  const fd = new FormData();
  fd.append('file', file);
  return call(`/api/upload${replace ? '?replace=1' : ''}`, { method: 'POST', body: fd });
};

export const setPrice = (isin, price) => call(`/api/prices/${encodeURIComponent(isin)}`, json('PUT', { price }));

export const refreshQuotes = () => call('/api/quotes/refresh', { method: 'POST' });

export const clearData = () => call('/api/data', { method: 'DELETE' });
