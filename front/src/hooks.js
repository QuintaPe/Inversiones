import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

/** Ruta en el hash (#/posiciones): navegación sin dependencias y con botón atrás. */
export function useHashRoute(valid, fallback) {
  // La ruta puede llevar un argumento: #/activo/US0378331005
  const read = () => {
    const r = window.location.hash.replace(/^#\/?/, '');
    return valid.includes(r.split('/')[0]) ? r : fallback;
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => {
      const next = read();
      // Con View Transitions el cambio de sección funde en lugar de saltar.
      if (document.startViewTransition && !reduceMotion()) document.startViewTransition(() => flushSync(() => setRoute(next)));
      else setRoute(next);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  // Cada sección empieza arriba (tras pintar, para que no lo deshaga el anclaje de scroll).
  useLayoutEffect(() => { window.scrollTo(0, 0); }, [route]);
  return [route, (r) => { window.location.hash = `/${r}`; }];
}

/** Ancho del contenedor, para dibujar los SVG a tamaño real. */
export function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Estado guardado en este navegador (preferencias de interfaz). */
export function useStored(key, initial) {
  const [v, setV] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : JSON.parse(raw);
    } catch {
      return initial;
    }
  });
  const set = (next) => {
    setV(next);
    try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* sin almacenamiento: solo en memoria */ }
  };
  return [v, set];
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Valor que va de la cifra anterior a la nueva en `ms` (suavizado al final), para que un cambio
 * de cotización se vea pasar en lugar de saltar. Sin animación con "reducir movimiento", en el
 * primer pintado y en saltos de más de un 25 % (otro filtro, otro periodo).
 */
export function useTween(value, ms = 450) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    from.current = value;
    if (value == null || start == null || start === value || reduceMotion()
      || Math.abs(value - start) > Math.abs(start) * 0.25) { setShown(value); return undefined; }
    let raf = 0;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = 1 - (1 - k) ** 3;
      setShown(start + (value - start) * e);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = value; };
  }, [value, ms]);
  return shown;
}
