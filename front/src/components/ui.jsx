import { useEffect, useRef, useState } from 'react';
import { eurS, pctS, sign } from '../lib/format.js';

/* ---------- iconos (trazo, 20px) ---------- */
const PATHS = {
  resumen: <path d="M4 13h6V4H4zM14 20h6V4h-6zM4 20h6v-3H4z" />,
  posiciones: <path d="M4 6h16M4 12h16M4 18h10" />,
  operaciones: <path d="M7 4v16M7 20l-3-3M17 20V4M17 4l3 3" />,
  dividendos: <><circle cx="12" cy="12" r="8" /><path d="M14.5 9.5c-.6-.8-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.8 0 2.4 5 1.2 5 3.6 0 1-1.1 1.8-2.5 1.8-1.1 0-2-.4-2.6-1.2M12 7v10" /></>,
  fiscalidad: <path d="M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6" />,
  upload: <path d="M12 16V4M12 4l-4 4M12 4l4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.5 6.6A16.5 16.5 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3 3 0 0 0 4.2 4.2" />,
  logout: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 16l4-4-4-4M14 12H3" />,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></>,
  download: <path d="M12 4v12M12 16l-4-4M12 16l4-4M4 19h16" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  alert: <path d="M12 4l9 16H3zM12 10v4M12 17v.5" />,
  chevron: <path d="M9 6l6 6-6 6" />,
  efectivo: <><path d="M3 7h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM3 7V6a2 2 0 0 1 2-2h11" /><circle cx="16.5" cy="13" r="1.2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  undo: <path d="M9 7H5V3M5 7a8 8 0 1 1-1.5 8" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  bars: <path d="M4 7h10M4 12h16M4 17h6" />,
  grid: <path d="M4 4h9v9H4zM15 4h5v5h-5zM15 11h5v9h-5zM4 15h9v5H4z" />,
};
export const Icon = ({ name, size = 20 }) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[name]}</svg>
);

/* ---------- identidad de un activo ---------- */
const hue = (s) => {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
};
const initials = (name) => {
  const w = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '?') + (w[1]?.[0] ?? w[0]?.[1] ?? '')).toUpperCase();
};
const noLogo = new Set(); // ISIN sin logotipo: no se vuelve a pedir en esta sesión
/** Logotipo del valor; mientras carga, o si no existe, se ven sus iniciales. */
export function Avatar({ p, size = '' }) {
  const [state, setState] = useState(noLogo.has(p.isin) ? 'none' : 'loading');
  useEffect(() => setState(noLogo.has(p.isin) ? 'none' : 'loading'), [p.isin]);
  return (
    <span className={`av ${size} ${state === 'ok' ? 'has-logo' : ''}`} style={{ '--h': hue(p.isin) }} aria-hidden="true">
      {state !== 'ok' && initials(p.name)}
      {state !== 'none' && (
        <img src={`/api/logos/${encodeURIComponent(p.isin)}`} alt="" loading="lazy" decoding="async"
          onLoad={() => setState('ok')} onError={() => { noLogo.add(p.isin); setState('none'); }} />
      )}
    </span>
  );
}
/** Avatar + nombre + línea secundaria. */
export const Asset = ({ p, children, size }) => (
  <span className="asset">
    <Avatar p={p} size={size} />
    <span className="asset-t">
      <b className="name">{p.name}</b>
      {children != null && children !== false && <small>{children}</small>}
    </span>
  </span>
);

/* ---------- bloques ---------- */
export const Card = ({ title, sub, right, children, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || right) && (
      <header className="card-h">
        <div><h2>{title}</h2>{sub && <p>{sub}</p>}</div>
        {right}
      </header>
    )}
    {children}
  </section>
);

/** Cifra con etiqueta. tone: 'gain' | 'loss' | '' */
export const Stat = ({ label, value, tone = '', hint }) => (
  <div className="stat">
    <span className="stat-l">{label}</span>
    <b className={`stat-v ${tone}`}>{value}</b>
    {hint && <span className="stat-h">{hint}</span>}
  </div>
);

/** Píldora de variación: flecha + signo, para no depender solo del color. */
export const Pill = ({ n, children, plain }) => {
  if (n == null) return <span className="mu">—</span>;
  return (
    <span className={`pill ${sign(n)}`}>
      {!plain && <span aria-hidden="true">{n > 0 ? '▲' : n < 0 ? '▼' : '•'}</span>}{children ?? pctS(n)}
    </span>
  );
};

export const Delta = ({ eur, pct, big }) => {
  if (eur == null) return <span className="mu">—</span>;
  return (
    <span className={`delta ${sign(eur)} ${big ? 'big' : ''}`}>
      {eurS(eur)}{pct != null && <Pill n={pct} />}
    </span>
  );
};

export const Seg = ({ options, value, onChange, label }) => (
  <div className="seg" role="group" aria-label={label}>
    {options.map(([k, text]) => (
      <button type="button" key={k} className={value === k ? 'on' : ''} aria-pressed={value === k} onClick={() => onChange(k)}>
        {text}
      </button>
    ))}
  </div>
);

const KIND = { B: ['Compra', 'buy'], S: ['Venta', 'sell'], D: ['Dividendo', 'div'] };
export const Kind = ({ k }) => <span className={`badge ${KIND[k][1]}`}>{KIND[k][0]}</span>;

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Search = ({ value, onChange, placeholder, label }) => (
  <label className="search">
    <Icon name="search" size={16} />
    <input type="search" placeholder={placeholder} aria-label={label} value={value} onChange={(ev) => onChange(ev.target.value)} />
  </label>
);

/** Clase 'flash-up' / 'flash-down' durante un instante cuando el valor cambia. */
export function useFlash(value) {
  const prev = useRef(value);
  const [cls, setCls] = useState('');
  useEffect(() => {
    const before = prev.current;
    prev.current = value;
    if (before == null || value == null || Math.abs(value - before) < 0.005) return undefined;
    setCls(value > before ? 'flash-up' : 'flash-down');
    const id = setTimeout(() => setCls(''), 1100);
    return () => clearTimeout(id);
  }, [value]);
  return cls;
}
export const Flash = ({ value, children, as: Tag = 'span', className = '' }) => (
  <Tag className={`${className} ${useFlash(value)}`}>{children}</Tag>
);

/** Precio editable: se guarda al salir del campo o con Intro. */
export function PriceInput({ p, onPrice }) {
  // Las cotizaciones en vivo traen muchos decimales: se enseñan 4 y solo se guarda
  // como precio manual si el usuario cambia de verdad el texto.
  const shown = p.price > 0 ? String(+p.price.toFixed(4)) : '';
  const [txt, setTxt] = useState(shown);
  useEffect(() => setTxt(shown), [shown]);
  const commit = () => {
    if (String(txt).trim() === shown) return;
    const n = parseFloat(String(txt).replace(',', '.'));
    onPrice(p.isin, n > 0 ? n : null);
  };
  return (
    <input
      className={`px ${p.price > 0 ? '' : 'missing'} ${p.priceSource === 'live' ? 'live' : ''}`}
      title={p.priceSource === 'live' ? 'Cotización en vivo; escribe para fijar un precio a mano' : undefined}
      type="number" step="any" min="0" inputMode="decimal" placeholder="Precio"
      aria-label={`Precio actual de ${p.name} en euros`}
      value={txt}
      onClick={(ev) => ev.stopPropagation()}
      onChange={(ev) => setTxt(ev.target.value)}
      onBlur={commit}
      onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()}
    />
  );
}

/** Cabecera de columna ordenable. */
export const Th = ({ id, sort, onSort, children, className = '' }) => (
  <th className={className} aria-sort={sort.key === id ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}>
    <button type="button" onClick={() => onSort(id)}>
      {children}<span className="arrow" aria-hidden="true">{sort.key === id ? (sort.dir > 0 ? '↑' : '↓') : ''}</span>
    </button>
  </th>
);

export function useSort(key, dir = -1) {
  const [sort, setSort] = useState({ key, dir });
  const onSort = (k) => setSort((s) => (s.key === k ? { key: k, dir: -s.dir } : { key: k, dir: k === 'name' ? 1 : -1 }));
  const apply = (rows, get) =>
    [...rows].sort((a, b) => {
      const x = get(a, sort.key), y = get(b, sort.key);
      if (x == null && y == null) return 0;
      if (x == null) return 1; // sin dato, siempre al final
      if (y == null) return -1;
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir;
    });
  return { sort, onSort, apply };
}

/** Botón que abre el selector de archivo. */
export function UploadButton({ onFile, busy, className = 'btn', children, label }) {
  const ref = useRef(null);
  return (
    <>
      <button type="button" className={className} disabled={busy} aria-label={label} title={label} onClick={() => ref.current.click()}>
        {children}
      </button>
      <input ref={ref} type="file" accept=".csv,text/csv" hidden
        onChange={(ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) onFile(f); }} />
    </>
  );
}

/** Menú desplegable anclado a su botón; se cierra con Escape o al pulsar fuera. */
export function Menu({ button, label, children }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const out = (ev) => !ref.current.contains(ev.target) && setOpen(false);
    const esc = (ev) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="menu-b" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {button}
      </button>
      {open && <div className="menu-p" role="menu">{typeof children === 'function' ? children(() => setOpen(false)) : children}</div>}
    </div>
  );
}

/** Avisos apilados; los de éxito se cierran solos. */
export function Toasts({ items, onClose }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => <Toast key={t.id} t={t} onClose={onClose} />)}
    </div>
  );
}
function Toast({ t, onClose }) {
  useEffect(() => {
    if (t.kind !== 'ok') return undefined;
    const id = setTimeout(() => onClose(t.id), 5000);
    return () => clearTimeout(id);
  }, [t, onClose]);
  return (
    <div className={`toast ${t.kind}`} role={t.kind === 'err' ? 'alert' : 'status'}>
      <Icon name={t.kind === 'ok' ? 'check' : 'alert'} size={18} />
      <span>{t.text}</span>
      <button type="button" className="icon" aria-label="Cerrar aviso" onClick={() => onClose(t.id)}><Icon name="close" size={16} /></button>
    </div>
  );
}

/** Esqueleto de carga del panel. */
export const Skeleton = () => (
  <div className="stack" aria-busy="true" aria-label="Cargando tu cartera">
    <div className="sk" style={{ height: 190 }} />
    <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="sk" style={{ height: 92 }} />)}</div>
    <div className="cols"><div className="sk" style={{ height: 320 }} /><div className="sk" style={{ height: 320 }} /></div>
  </div>
);
