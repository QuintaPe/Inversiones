import { useEffect, useState } from 'react';
import { Icon } from './ui.jsx';
import { date } from '../lib/format.js';

/** Pregunta de confirmación propia (sustituye al cuadro del navegador). */
export function Confirm({ title, text, action = 'Aceptar', danger, onAnswer }) {
  useEffect(() => {
    const key = (ev) => { if (ev.key === 'Escape') onAnswer(false); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onAnswer]);
  return (
    <div className="scrim top" onClick={() => onAnswer(false)}>
      <div className="sheet small" role="alertdialog" aria-modal="true" aria-label={title} onClick={(ev) => ev.stopPropagation()}>
        <h2 className="sheet-q">{title}</h2>
        {text && <p className="sheet-p">{text}</p>}
        <div className="sheet-a">
          <button type="button" className="btn" onClick={() => onAnswer(false)}>Cancelar</button>
          <button type="button" className={`btn ${danger ? 'bad' : 'pri'}`} autoFocus onClick={() => onAnswer(true)}>{action}</button>
        </div>
      </div>
    </div>
  );
}

const plural = (n, one, many) => `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`;

/** Lo que va a cambiar al importar un CSV, antes de guardarlo. */
export function ImportPreview({ preview: p, hasData, onImport, onClose }) {
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState(false);
  const unknown = Object.entries(p.unknown ?? {});
  const nothing = p.added === 0 && !replace;
  const run = async () => { setBusy(true); await onImport(replace); };
  return (
    <div className="scrim top" onClick={busy ? undefined : onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Importar CSV" onClick={(ev) => ev.stopPropagation()}>
        <header className="sheet-h">
          <h2>Importar CSV</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose} disabled={busy}><Icon name="close" /></button>
        </header>
        <p className="sheet-p">
          <b>{p.name}</b><br />
          {plural(p.total, 'fila', 'filas')}{p.from && <> · del {date(p.from)} al {date(p.to)}</>} · {plural(p.relevant, 'de inversión', 'de inversión')}
        </p>
        <ul className="imp">
          <li className={p.added ? 'on' : ''}><b>{p.added.toLocaleString('es-ES')}</b><span>{p.added === 1 ? 'nueva' : 'nuevas'}</span></li>
          <li><b>{p.known.toLocaleString('es-ES')}</b><span>ya las tenías</span></li>
          <li><b>{p.removed.toLocaleString('es-ES')}</b><span>{p.removed === 1 ? 'quitada por ti' : 'quitadas por ti'}</span></li>
        </ul>
        {p.removed > 0 && <p className="note">Las operaciones que quitaste no vuelven al importar; puedes restaurarlas desde Operaciones.</p>}
        {unknown.length > 0 && (
          <p className="note warn-t">
            <Icon name="alert" size={15} /> {plural(unknown.reduce((t, [, n]) => t + n, 0), 'fila es', 'filas son')} de un tipo que la app todavía
            no interpreta ({unknown.map(([t]) => t).join(', ')}). Se guardan, pero no cambian tus posiciones.
          </p>
        )}
        {hasData && (
          <label className="check">
            <input type="checkbox" checked={replace} onChange={(ev) => setReplace(ev.target.checked)} />
            <span>Sustituir todo: borrar las operaciones actuales (también las añadidas a mano) y dejar solo las de este archivo</span>
          </label>
        )}
        <div className="sheet-a">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className={`btn ${replace ? 'bad' : 'pri'}`} onClick={run} disabled={busy || nothing}>
            {busy ? 'Importando…' : nothing ? 'No hay nada nuevo' : replace ? 'Sustituir todo' : `Importar ${plural(p.added, 'operación', 'operaciones')}`}
          </button>
        </div>
      </div>
    </div>
  );
}
