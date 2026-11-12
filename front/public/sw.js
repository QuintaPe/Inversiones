// Service worker: la app abre sin conexión y enseña los últimos datos que cargó.
const SHELL = 'shell-v1';
const DATA = 'data-v1';
// Solo estas lecturas se guardan para verlas sin conexión.
const OFFLINE_API = ['/api/portfolio', '/api/history', '/api/cash', '/api/me', '/api/config', '/api/dividends/forecast'];

self.addEventListener('install', (ev) => {
  ev.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (ev) => {
  ev.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => ![SHELL, DATA].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
// Al cerrar sesión se borran los datos guardados.
self.addEventListener('message', (ev) => {
  if (ev.data === 'clear-data') ev.waitUntil(caches.delete(DATA));
});

self.addEventListener('fetch', (ev) => {
  const req = ev.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith('/api/')) {
    const keep = OFFLINE_API.includes(url.pathname) || url.pathname.startsWith('/api/logos/');
    if (!keep) return;
    // Primero la red; si falla, la última respuesta guardada, marcada como tal.
    ev.respondWith(
      fetch(req).then((res) => {
        if (res.ok) { const copy = res.clone(); caches.open(DATA).then((c) => c.put(req, copy)); }
        return res;
      }).catch(async () => {
        const hit = await caches.match(req);
        if (!hit) throw new Error('offline');
        const headers = new Headers(hit.headers);
        headers.set('X-Offline-Cache', '1');
        return new Response(hit.body, { status: hit.status, headers });
      }),
    );
    return;
  }

  // Navegación: la red y, sin conexión, la página guardada.
  if (req.mode === 'navigate') {
    ev.respondWith(fetch(req).then((res) => { caches.open(SHELL).then((c) => c.put('/', res.clone())); return res; })
      .catch(() => caches.match('/')));
    return;
  }
  // Estáticos (con huella en el nombre): caché primero.
  ev.respondWith(
    caches.match(req).then((hit) => hit ?? fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then((c) => c.put(req, copy)); }
      return res;
    })),
  );
});
