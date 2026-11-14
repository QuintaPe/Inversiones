import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Icon } from './ui.jsx';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Acciones del buscador: lo mismo que hay en la barra y en el menú de la cuenta, sin ratón. */
const actionsOf = (c) => [
  { key: 'op', label: 'Añadir una operación', icon: 'plus', words: 'compra venta dividendo nueva', run: c.addOp },
  { key: 'csv', label: 'Subir un CSV de Trade Republic', icon: 'upload', words: 'importar archivo', run: c.pickCsv },
  c.refresh && { key: 'quotes', label: 'Actualizar las cotizaciones', icon: 'undo', words: 'precios refrescar recargar', run: c.refresh },
  { key: 'hide', label: c.hidden ? 'Mostrar los importes' : 'Ocultar los importes', icon: c.hidden ? 'eye' : 'eyeOff', words: 'privado cifras modo', run: c.toggleHidden },
  ...c.themes.filter(([k]) => k !== c.theme).map(([k, l]) => ({ key: `theme-${k}`, label: `Tema: ${l.toLowerCase()}`, icon: 'grid', words: 'claro oscuro apariencia color', run: () => c.setTheme(k) })),
  { key: 'export', label: 'Descargar una copia de mis datos', icon: 'download', words: 'exportar backup', run: () => { window.location.href = c.exportUrl; } },
  { key: 'restore', label: 'Restaurar una copia', icon: 'undo', words: 'importar backup', run: c.restore },
  { key: 'logout', label: 'Cerrar sesión', icon: 'logout', words: 'salir', run: c.logout },
].filter(Boolean);

/**
 * Buscador y comandos (Ctrl/⌘ + K): secciones, cualquier valor de la cartera y acciones.
 * @param cmd  lo que las acciones necesitan de la app (ver App.jsx)
 */
export default function Palette({ sections, positions, cmd = null, onGo, onClose }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const list = useRef(null);
  const items = useMemo(() => {
    const s = norm(q.trim());
    const secs = sections
      .filter(([, label]) => !s || norm(label).includes(s))
      .map(([k, label]) => ({ key: k, label, hint: 'Sección', icon: k, to: k }));
    const pos = positions
      .filter((p) => !s || norm(`${p.name} ${p.isin} ${p.priceInfo?.symbol ?? ''} ${p.sector ?? ''}`).includes(s))
      .sort((a, b) => Number(b.open) - Number(a.open) || a.name.localeCompare(b.name))
      .slice(0, s ? 12 : 6)
      .map((p) => ({ key: p.isin, label: p.name, hint: `${p.priceInfo?.symbol ?? p.isin}${p.open ? '' : ' · cerrada'}`, p, to: `activo/${p.isin}` }));
    const acts = (cmd ? actionsOf(cmd) : [])
      .filter((a) => !s || norm(`${a.label} ${a.words ?? ''}`).includes(s))
      .map((a) => ({ key: `do-${a.key}`, label: a.label, hint: a.hint ?? 'Acción', icon: a.icon, run: a.run }));
    return s ? [...pos, ...acts, ...secs] : [...secs, ...pos, ...acts];
  }, [q, sections, positions, cmd]);
  const pick = (it) => { if (it.run) { onClose(); it.run(); } else onGo(it.to); };

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);
  useEffect(() => { list.current?.children[sel]?.scrollIntoView({ block: 'nearest' }); }, [sel]);

  const key = (ev) => {
    if (ev.key === 'Escape') onClose();
    else if (ev.key === 'ArrowDown') { ev.preventDefault(); setSel((i) => Math.min(items.length - 1, i + 1)); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setSel((i) => Math.max(0, i - 1)); }
    else if (ev.key === 'Enter' && items[sel]) pick(items[sel]);
  };

  return (
    <div className="scrim top" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Buscar" onClick={(ev) => ev.stopPropagation()}>
        <label className="palette-in">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={key}
            placeholder="Buscar un valor, una sección o una acción" aria-label="Buscar" role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <kbd>Esc</kbd>
        </label>
        <ul id="palette-list" ref={list} role="listbox">
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === sel}>
              <button type="button" className={i === sel ? 'on' : ''} onPointerMove={() => setSel(i)} onClick={() => pick(it)}>
                {it.p ? <Avatar p={it.p} size="sm" /> : <span className="av sm"><Icon name={it.icon} size={16} /></span>}
                <span>{it.label}</span>
                <small>{it.hint}</small>
              </button>
            </li>
          ))}
          {!items.length && <li className="empty">Sin resultados para «{q}».</li>}
        </ul>
      </div>
    </div>
  );
}
