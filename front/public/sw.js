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
// Estáticos de compilaciones anteriores: sobran en cuanto llega una página nueva que ya no los usa.
async function prune(html) {
  const c = await caches.open(SHELL);
  for (const req of await c.keys()) {
    const p = new URL(req.url).pathname;
    // Solo JS y CSS: las fuentes las referencia el CSS, no la página, y casi nunca cambian.
    if (p.startsWith('/assets/') && /\.(js|css)$/.test(p) && !html.includes(p)) await c.delete(req);
  }
}
// Guarda la página; si ha cambiado (despliegue nuevo), limpia los estáticos que ya no referencia.
async function keepPage(res) {
  const c = await caches.open(SHELL);
  const [html, old] = await Promise.all([res.clone().text(), c.match('/').then((r) => r?.text())]);
  await c.put('/', res);
  if (old !== undefined && old !== html) await prune(html);
}

// Los datos guardados son de un usuario: si la sesión ya no es la suya, se borran.
const OWNER = '/__owner';
async function keepData(req, res) {
  if (new URL(req.url).pathname === '/api/me') {
    const id = (await res.clone().json().catch(() => null))?.user?.id ?? null;
    const owner = await caches.open(DATA).then((c) => c.match(OWNER)).then((r) => r?.text());
    if (!id || (owner && owner !== id)) await caches.delete(DATA);
    if (!id) return;
    await caches.open(DATA).then((c) => c.put(OWNER, new Response(id)));
  }
  await caches.open(DATA).then((c) => c.put(req, res));
}

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
        if (res.ok) ev.waitUntil(keepData(req, res.clone()).catch(() => {}));
        else if (res.status === 401) ev.waitUntil(caches.delete(DATA)); // sesión caducada
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
    ev.respondWith(fetch(req).then((res) => {
      // La copia se saca antes de devolver la respuesta: después su cuerpo ya está en uso.
      if (res.ok) ev.waitUntil(keepPage(res.clone()).catch(() => {}));
      return res;
    }).catch(() => caches.match('/')));
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

// Avisos (alertas de precio) enviados por el servidor, también con la app cerrada.
self.addEventListener('push', (ev) => {
  let d = {};
  try { d = ev.data?.json() ?? {}; } catch { /* aviso sin contenido legible */ }
  ev.waitUntil(self.registration.showNotification(d.title || 'Cartera', {
    body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', tag: d.tag, data: { url: d.url || '/' },
  }));
});
self.addEventListener('notificationclick', (ev) => {
  ev.notification.close();
  const url = ev.notification.data?.url || '/';
  ev.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    const open = list.find((c) => new URL(c.url).origin === self.location.origin);
    if (!open) return self.clients.openWindow(url);
    return open.navigate(url).then((c) => (c ?? open).focus());
  }));
});
