import { useEffect, useRef, useState } from 'react';

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

/**
 * Deslizar hacia abajo desde arriba del todo para actualizar (pantallas táctiles). Sustituye al
 * gesto del navegador, que recargaría la app entera, por `onRefresh` (una promesa).
 * No arranca sobre gráficas (se recorren con el dedo), diálogos ni campos de texto.
 * Devuelve { pull: px desplazados (0–110), busy: actualizando }.
 */
export const PULL_AT = 64;
export function usePullToRefresh(onRefresh, enabled) {
  const [state, setState] = useState({ pull: 0, busy: false });
  const busy = useRef(false);
  const run = useRef(onRefresh);
  run.current = onRefresh;
  useEffect(() => {
    if (!enabled || !window.matchMedia?.('(pointer: coarse)').matches) return undefined;
    let y0 = null, d = 0;
    const start = (ev) => {
      y0 = null;
      if (busy.current || window.scrollY > 0 || ev.touches.length > 1) return;
      if (ev.target.closest?.('.chart, .scrim, .sheet, .palette, .menu-p, input, select, textarea')) return;
      y0 = ev.touches[0].clientY;
      d = 0;
    };
    const move = (ev) => {
      if (y0 == null) return;
      const dy = ev.touches[0].clientY - y0;
      if (dy <= 0 || window.scrollY > 0) { if (d) setState({ pull: 0, busy: false }); y0 = null; d = 0; return; }
      d = Math.min(110, dy * 0.5); // resistencia: el indicador avanza la mitad que el dedo
      setState({ pull: d, busy: false });
      if (ev.cancelable) ev.preventDefault();
    };
    const end = async () => {
      if (y0 == null) return;
      y0 = null;
      if (d < PULL_AT) { d = 0; setState({ pull: 0, busy: false }); return; }
      d = 0;
      busy.current = true;
      setState({ pull: PULL_AT, busy: true });
      try { await run.current(); } catch { /* el propio onRefresh avisa del error */ }
      busy.current = false;
      setState({ pull: 0, busy: false });
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: false });
    window.addEventListener('touchend', end);
    window.addEventListener('touchcancel', end);
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, [enabled]);
  return state;
}

/**
 * ¿Está pegado un elemento con position:sticky? Compara su posición con su `top` calculado.
 * Devuelve [ref, pegado]. Un solo cálculo por fotograma mientras se hace scroll.
 */
export function useStuck() {
  const ref = useRef(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    let raf = 0;
    const check = () => {
      raf = 0;
      const el = ref.current;
      if (!el) return;
      const top = parseFloat(getComputedStyle(el).top) || 0;
      setStuck(window.scrollY > 0 && el.getBoundingClientRect().top <= top + 0.5);
    };
    const on = () => { if (!raf) raf = requestAnimationFrame(check); };
    check();
    window.addEventListener('scroll', on, { passive: true });
    window.addEventListener('resize', on);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('scroll', on); window.removeEventListener('resize', on); };
  }, []);
  return [ref, stuck];
}
