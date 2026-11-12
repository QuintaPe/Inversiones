import { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** Ruta en el hash (#/posiciones): navegación sin dependencias y con botón atrás. */
export function useHashRoute(valid, fallback) {
  // La ruta puede llevar un argumento: #/activo/US0378331005
  const read = () => {
    const r = window.location.hash.replace(/^#\/?/, '');
    return valid.includes(r.split('/')[0]) ? r : fallback;
  };
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => setRoute(read());
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
