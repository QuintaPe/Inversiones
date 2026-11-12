import { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Icon } from './ui.jsx';

const norm = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');

/** Buscador global (Ctrl/⌘ + K): secciones y cualquier valor de la cartera. */
export default function Palette({ sections, positions, onGo, onClose }) {
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
    return [...(s ? pos : secs), ...(s ? secs : pos)];
  }, [q, sections, positions]);

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
    else if (ev.key === 'Enter' && items[sel]) onGo(items[sel].to);
  };

  return (
    <div className="scrim top" onClick={onClose}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Buscar" onClick={(ev) => ev.stopPropagation()}>
        <label className="palette-in">
          <Icon name="search" size={18} />
          <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={key}
            placeholder="Buscar un valor, ISIN o sección" aria-label="Buscar" role="combobox" aria-expanded="true" aria-controls="palette-list" />
          <kbd>Esc</kbd>
        </label>
        <ul id="palette-list" ref={list} role="listbox">
          {items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === sel}>
              <button type="button" className={i === sel ? 'on' : ''} onPointerMove={() => setSel(i)} onClick={() => onGo(it.to)}>
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
