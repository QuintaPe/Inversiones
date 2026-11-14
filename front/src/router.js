// Navegación con URLs limpias (/posiciones, /activo/US0378331005?ver=operaciones), sin dependencias.
// - Los enlaces <a href="/..."> internos navegan sin recargar (con Ctrl o en nueva pestaña, como siempre).
// - Cada entrada del historial guarda su posición de scroll: al volver atrás se recupera.
// - El estado de cada sección (pestaña, filtros, búsqueda) vive en la URL con useParam, así
//   que se puede enlazar, recargar y compartir.
// - Los enlaces antiguos con hash (#/activo/...) se convierten solos.
import { useLayoutEffect, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

const listeners = new Set();
let snap = read();
let pending = null; // { scroll } tras volver atrás o adelante; null en una navegación nueva

function read() {
  const { pathname, search } = window.location;
  const raw = pathname.replace(/^\/+|\/+$/g, '');
  let path = raw;
  try { path = decodeURIComponent(raw); } catch { /* URL mal formada (/%E0): se usa tal cual y acaba en la ruta por defecto */ }
  return { path, search };
}
const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Avisa a los componentes; con View Transitions el cambio de sección funde en lugar de saltar. */
function emit(animate) {
  const next = read();
  if (next.path === snap.path && next.search === snap.search) return;
  const sectionChanged = next.path !== snap.path;
  const apply = () => { snap = next; listeners.forEach((l) => l()); };
  if (animate && sectionChanged && document.startViewTransition && !reduceMotion()) document.startViewTransition(() => flushSync(apply));
  else apply();
}

// Índice de la entrada en el historial de esta app: atrás solo vuelve dentro de la app.
const idx = () => window.history.state?.idx ?? 0;
// Última posición confirmada por un evento de scroll: leer scrollY justo al pulsar un enlace
// no es fiable (el navegador puede haber recortado ya la página en ese mismo fotograma).
let lastY = 0;
function saveScroll(y = lastY) {
  window.history.replaceState({ ...window.history.state, idx: idx(), scroll: y }, '');
}

let started = false;
function start() {
  if (started) return;
  started = true;
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual';
  // #/activo/X → /activo/X (enlaces guardados, avisos push antiguos).
  const h = window.location.hash;
  if (h.startsWith('#/')) window.history.replaceState({ idx: 0 }, '', `/${h.slice(2)}`);
  else if (window.history.state?.idx == null) window.history.replaceState({ ...window.history.state, idx: 0 }, '');
  else if (window.history.state.scroll) pending = { scroll: window.history.state.scroll }; // recarga: donde estaba
  snap = read();

  window.addEventListener('popstate', (ev) => {
    const y = ev.state?.scroll ?? 0;
    if (read().path === snap.path) { emit(false); restore(y); return; } // solo cambió la búsqueda
    pending = { scroll: y }; // se aplica al pintar la sección (useRoute)
    emit(true);
  });
  // La posición se apunta al irse de la página (recargar o cerrar) y al navegar.
  lastY = window.scrollY;
  window.addEventListener('scroll', () => { lastY = window.scrollY; }, { passive: true });
  window.addEventListener('pagehide', () => saveScroll(window.scrollY));
  document.addEventListener('click', (ev) => {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    const a = /** @type {HTMLAnchorElement | null} */ (/** @type {Element} */ (ev.target).closest?.('a[href]'));
    if (!a || a.target || a.hasAttribute('download') || a.getAttribute('href').startsWith('#')) return;
    const url = new URL(a.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return;
    ev.preventDefault();
    navigate(url.pathname.slice(1) + url.search);
  });
}

/** Ir a una ruta ('posiciones', 'activo/ES01...?ver=operaciones'). */
export function navigate(to, { replace = false } = {}) {
  const url = `/${to.replace(/^\/+/, '')}`;
  if (url === window.location.pathname + window.location.search) { window.scrollTo(0, 0); return; }
  if (replace) window.history.replaceState({ ...window.history.state }, '', url);
  else {
    saveScroll();
    window.history.pushState({ idx: idx() + 1, scroll: 0 }, '', url);
  }
  emit(true);
}

/** Atrás si la página anterior es de la app; si no (enlace directo), a `fallback`. */
export function goBack(fallback) {
  if (idx() > 0) window.history.back();
  else navigate(fallback, { replace: true });
}

/**
 * Vuelve al scroll guardado. Las secciones se cargan bajo demanda y crecen al llegar los datos:
 * se insiste hasta que la posición aguanta unos fotogramas seguidos (o 2 s), y se deja de
 * insistir en cuanto la persona hace scroll por su cuenta.
 */
let stopRestore = () => {};
function restore(y) {
  stopRestore();
  let raf = 0, stable = 0;
  const t0 = performance.now();
  const stop = () => { cancelAnimationFrame(raf); USER.forEach((e) => window.removeEventListener(e, stop)); };
  const step = () => {
    if (Math.abs(window.scrollY - y) > 1) { stable = 0; window.scrollTo(0, y); } else stable++;
    if (stable < 12 && performance.now() - t0 < 2000) raf = requestAnimationFrame(step); else stop();
  };
  USER.forEach((e) => window.addEventListener(e, stop, { passive: true }));
  stopRestore = stop;
  raf = requestAnimationFrame(step);
}
const USER = ['wheel', 'touchstart', 'keydown', 'pointerdown'];

function subscribe(l) {
  start();
  listeners.add(l);
  return () => listeners.delete(l);
}
const get = () => snap;

/**
 * Ruta actual: [ruta, ir]. `valid` son las primeras partes admitidas; cualquier otra lleva a
 * `fallback` (sin dejar la URL equivocada en el historial).
 */
export function useRoute(valid, fallback) {
  start();
  const { path } = useSyncExternalStore(subscribe, get);
  const ok = valid.includes(path.split('/')[0]);
  useLayoutEffect(() => { if (!ok) navigate(fallback, { replace: true }); }, [ok, fallback]);
  // Cada sección nueva empieza arriba (tras pintar, para que no lo deshaga el anclaje de scroll);
  // al volver atrás o adelante, o al recargar, donde estaba.
  useLayoutEffect(() => {
    if (pending) { restore(pending.scroll); pending = null; } else window.scrollTo(0, 0);
  }, [path]);
  return [ok ? path : fallback, navigate];
}

/**
 * Un parámetro de la URL como estado: const [tab, setTab] = useParam('ver', 'open', { open: 'abiertas' }).
 * Cambiarlo no añade una entrada al historial (los filtros no son páginas) y el valor por
 * defecto no se escribe, para que las URLs queden limpias.
 */
export function useParam(key, initial, names = null) {
  const { search } = useSyncExternalStore(subscribe, get);
  // `names` traduce los valores internos a palabras legibles en la URL: { open: 'abiertas' }.
  const raw = new URLSearchParams(search).get(key);
  const value = raw == null ? initial : names ? (Object.keys(names).find((k) => names[k] === raw) ?? initial) : raw;
  const set = (next) => {
    const v = typeof next === 'function' ? next(value) : next;
    const q = new URLSearchParams(window.location.search);
    if (v == null || v === '' || v === initial) q.delete(key); else q.set(key, String(names?.[v] ?? v));
    const s = q.toString();
    window.history.replaceState({ ...window.history.state }, '', window.location.pathname + (s ? `?${s}` : ''));
    emit(false);
  };
  return [value, set];
}
