import { useEffect, useMemo, useRef, useState } from 'react';
import * as api from '../api.js';
import { Asset, Empty, Icon, Kind, Search, Seg, Sticky } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { useParam } from '../router.js';
import { sum } from '../lib/calc.js';
import { eur, eurS, qty, sign, date } from '../lib/format.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLong = (ym) => { const m = MONTHS[+ym.slice(5, 7) - 1]; return `${m[0].toUpperCase()}${m.slice(1)} de ${ym.slice(0, 4)}`; };

const KINDS = [['all', 'Todas'], ['B', 'Compras'], ['S', 'Ventas'], ['D', 'Dividendos']];
const PAGE = 100;

function download(rows) {
  const head = ['fecha', 'tipo', 'activo', 'isin', 'cantidad', 'precio', 'importe_bruto', 'comision', 'impuesto_retencion', 'neto', 'resultado_coste_medio', 'resultado_fifo', 'id'];
  const n = (v) => (v == null ? '' : String(+v.toFixed(6)).replace('.', ','));
  const lines = rows.map((x) => [
    x.d, { B: 'compra', S: 'venta', D: 'dividendo' }[x.k], `"${x.p.name.replace(/"/g, '""')}"`, x.p.isin,
    n(x.sh), n(x.px), n(x.g), n(x.fee), n(x.tax), n(x.net), n(x.re), n(x.reF), x.id,
  ].join(';'));
  const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const el = document.createElement('a');
  el.href = URL.createObjectURL(blob);
  el.download = 'operaciones.csv';
  el.click();
  URL.revokeObjectURL(el.href);
}

export default function Ledger({ a, meta, onOpen, onAddOp, onRestoreOp }) {
  const [removed, setRemoved] = useState([]);
  useEffect(() => { api.getRemoved().then((r) => setRemoved(r.removed)).catch(() => {}); }, [meta?.rows]);
  const [kind, setKind] = useParam('tipo', 'all', { B: 'compras', S: 'ventas', D: 'dividendos' });
  const [year, setYear] = useParam('año', 'all');
  const [q, setQ] = useParam('q', '');
  const [limit, setLimit] = useState(PAGE);
  const years = useMemo(() => [...new Set(a.ops.map((x) => x.d.slice(0, 4)))].sort().reverse(), [a.ops]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return a.ops.filter((x) =>
      (kind === 'all' || x.k === kind) && (year === 'all' || x.d.startsWith(year)) &&
      (!s || `${x.p.name} ${x.p.isin} ${(x.ids ?? [x.id]).join(' ')}`.toLowerCase().includes(s)));
  }, [a.ops, kind, year, q]);
  // Al acercarse al final se cargan las siguientes (el botón sigue ahí para el teclado).
  const more = useRef(null);
  const hasMore = rows.length > limit;
  useEffect(() => {
    if (!hasMore || !more.current || !('IntersectionObserver' in window)) return undefined;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setLimit((l) => l + PAGE); }, { rootMargin: '600px 0px' });
    io.observe(more.current);
    return () => io.disconnect();
  }, [hasMore, limit]);
  const B = rows.filter((x) => x.k === 'B'), S = rows.filter((x) => x.k === 'S'), D = rows.filter((x) => x.k === 'D');
  // Por meses, como en el extracto del banco.
  const groups = useMemo(() => {
    const out = [];
    for (const x of rows.slice(0, limit)) {
      const m = x.d.slice(0, 7);
      if (out.at(-1)?.m !== m) out.push({ m, items: [] });
      out.at(-1).items.push(x);
    }
    return out;
  }, [rows, limit]);

  return (
    <div className="stack">
      <Sticky>
        <Seg label="Tipo de operación" options={KINDS} value={kind} onChange={(k) => { setKind(k); setLimit(PAGE); }} />
      </Sticky>
      <div className="toolbar">
        <select aria-label="Año" value={year} onChange={(ev) => { setYear(ev.target.value); setLimit(PAGE); }}>
          <option value="all">Todos los años</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <Search value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Buscar activo, ISIN o ID" label="Buscar operación" />
        <button type="button" className="btn btn-ic-s" disabled={!rows.length} onClick={() => download(rows)} aria-label="Exportar CSV"><Icon name="download" size={16} /><span className="btn-l">Exportar CSV</span></button>
        <button type="button" className="btn pri btn-ic-s" onClick={() => onAddOp({})} aria-label="Añadir operación"><Icon name="plus" size={16} /><span className="btn-l">Añadir operación</span></button>
      </div>

      <div className="kpis-row">
        <Kpi label="Compras" value={eur(sum(B, (x) => x.net))} sub={`${B.length} · con comisiones`} />
        <Kpi label="Ventas" value={eur(sum(S, (x) => x.net))} sub={`${S.length} · neto de comisión`} />
        <Kpi label="Dividendos netos" value={eur(sum(D, (x) => x.net))} sub={`${D.length} cobros`} tone={D.length ? 'gain' : ''} />
        <Kpi label="Comisiones" value={eur(sum(rows, (x) => x.fee || 0))} sub={`${rows.filter((x) => x.fee).length} de ${rows.length} operaciones`} />
      </div>

      {!rows.length && <div className="card"><Empty>Ninguna operación coincide con los filtros.</Empty></div>}
      {groups.map((gr) => (
        <section key={gr.m} className="card ops-m" style={{ '--n': gr.items.length }}>
          <header className="ops-mh">
            <h2>{monthLong(gr.m)}</h2>
            <span className="mu">{gr.items.length} {gr.items.length === 1 ? 'operación' : 'operaciones'}</span>
          </header>
          <ul className="ops-l">
            {gr.items.map((x) => (
              <li key={x.id + x.k}>
                <button type="button" onClick={() => onOpen(x.p.isin)} title={`ID ${(x.ids ?? [x.id]).join(', ')}`}>
                  <Asset p={x.p} size="sm">
                    {date(x.d)} · {x.k === 'D' ? `${qty(x.sh)} uds.` : `${qty(x.sh)} × ${eur(x.px)}`}
                    {x.fee ? ` · comisión ${eur(x.fee)}` : ''}{x.tax ? ` · ${x.k === 'D' ? 'retención' : 'impuesto'} ${eur(x.tax)}` : ''}
                    {x.parts ? ` · ${x.parts.length} ejecuciones` : ''}
                  </Asset>
                  <span className="row-r">
                    <span className={`row-v ${x.k === 'B' ? '' : 'gain'}`}>{x.k === 'B' ? `−${eur(x.net)}` : eurS(x.net)}</span>
                    <span className="ops-k">
                      {x.k === 'S' && <small className={sign(x.re)}>{eurS(x.re)}</small>}
                      <Kind k={x.k} />
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {hasMore && (
        <div className="more" ref={more}><button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
          Mostrar más ({rows.length - limit} restantes)</button></div>
      )}
      {removed.length > 0 && (
        <div className="card">
          <header className="card-h"><div><h2>Operaciones quitadas ({removed.length})</h2><p>No cuentan en ningún cálculo ni vuelven al resubir el CSV</p></div></header>
          <ul className="vals">
            {removed.map((r) => (
              <li key={r.transaction_id}>
                <span>{date(r.date)} · {r.name} · {{ BUY: 'compra', SELL: 'venta', DIVIDEND: 'dividendo' }[r.type] ?? r.type.toLowerCase()}</span>
                <b>{r.amount ? eur(Math.abs(parseFloat(r.amount))) : ''}</b>
                <button type="button" className="btn" onClick={() => onRestoreOp(r.transaction_id)}><Icon name="undo" size={15} />Restaurar</button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="note">
        Neto: lo que sale (−) o entra (+) de tu cuenta, comisiones e impuestos incluidos. El resultado de cada venta usa el
        coste medio ponderado; el criterio FIFO está en Fiscalidad. Las ejecuciones parciales de una misma orden (mismo
        día y una sola comisión) se muestran juntas, con el precio medio de la orden. El ID son los últimos 8 caracteres
        del <i> transaction_id</i> del CSV.
      </p>
    </div>
  );
}
