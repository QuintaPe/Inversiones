import { useMemo, useState } from 'react';
import { Asset, Empty, Icon, Kind, Search, Seg, Stat } from '../components/ui.jsx';
import { sum } from '../lib/calc.js';
import { eur, eurS, num, qty, sign, date } from '../lib/format.js';

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

export default function Ledger({ a, onOpen }) {
  const [kind, setKind] = useState('all');
  const [year, setYear] = useState('all');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const years = useMemo(() => [...new Set(a.ops.map((x) => x.d.slice(0, 4)))].sort().reverse(), [a.ops]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return a.ops.filter((x) =>
      (kind === 'all' || x.k === kind) && (year === 'all' || x.d.startsWith(year)) &&
      (!s || `${x.p.name} ${x.p.isin} ${(x.ids ?? [x.id]).join(' ')}`.toLowerCase().includes(s)));
  }, [a.ops, kind, year, q]);
  const B = rows.filter((x) => x.k === 'B'), S = rows.filter((x) => x.k === 'S'), D = rows.filter((x) => x.k === 'D');

  return (
    <div className="stack">
      <div className="toolbar">
        <Seg label="Tipo de operación" options={KINDS} value={kind} onChange={(k) => { setKind(k); setLimit(PAGE); }} />
        <select aria-label="Año" value={year} onChange={(ev) => { setYear(ev.target.value); setLimit(PAGE); }}>
          <option value="all">Todos los años</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
        <Search value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Buscar activo, ISIN o ID" label="Buscar operación" />
        <button type="button" className="btn" disabled={!rows.length} onClick={() => download(rows)}><Icon name="download" size={16} />Exportar CSV</button>
      </div>

      <div className="card stats five">
        <Stat label="Operaciones" value={rows.length} />
        <Stat label="Compras" value={eur(sum(B, (x) => x.net))} hint={`${B.length} · con comisiones`} />
        <Stat label="Ventas" value={eur(sum(S, (x) => x.net))} hint={`${S.length} · neto de comisión`} />
        <Stat label="Dividendos netos" value={eur(sum(D, (x) => x.net))} hint={`${D.length} cobros`} />
        <Stat label="Comisiones" value={eur(sum(rows, (x) => x.fee || 0))} hint={`${rows.filter((x) => x.fee).length} operaciones con comisión`} />
      </div>

      <div className="card table-card">
        <table className="tbl">
          <thead>
            <tr>
              <th className="l hide-s">Fecha</th><th className="l">Tipo</th><th className="l">Activo</th>
              <th className="hide-s">Cantidad</th><th className="hide-s">Precio</th>
              <th className="hide-m hide-l">Bruto</th><th className="hide-m">Comisión</th><th className="hide-m">Imp. / ret.</th>
              <th>Neto</th><th className="hide-s">Resultado</th><th className="hide-m hide-l l">ID</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((x) => (
              <tr key={x.id + x.k} onClick={() => onOpen(x.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(x.p.isin)}>
                <td className="l nowrap hide-s">{date(x.d)}</td>
                <td className="l"><Kind k={x.k} /></td>
                <td className="l"><Asset p={x.p} size="sm">
                  <span className="only-s">{date(x.d)} · {x.k !== 'D' ? `${qty(x.sh)} × ${eur(x.px)}` : `${qty(x.sh)} uds.`}</span></Asset></td>
                <td className="hide-s">{qty(x.sh)}{x.parts && <small>{x.parts.length} ejecuciones</small>}</td>
                <td className="hide-s">{x.k === 'D' ? <span className="mu">—</span> : eur(x.px)}</td>
                <td className="hide-m hide-l">{num(x.g)}</td>
                <td className="hide-m">{x.fee ? num(x.fee) : <span className="mu">—</span>}</td>
                <td className="hide-m">{x.tax ? num(x.tax) : <span className="mu">—</span>}</td>
                <td>{x.k === 'B' ? `−${eur(x.net)}` : eurS(x.net)}</td>
                <td className={`hide-s ${x.k === 'S' ? sign(x.re) : ''}`}>{x.k === 'S' ? eurS(x.re) : <span className="mu">—</span>}</td>
                <td className="hide-m hide-l l mono">{x.id}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>Ninguna operación coincide con los filtros.</Empty>}
        {rows.length > limit && (
          <div className="more"><button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>
            Mostrar más ({rows.length - limit} restantes)</button></div>
        )}
      </div>
      <p className="note">
        Neto: lo que sale (−) o entra (+) de tu cuenta, comisiones e impuestos incluidos. El resultado de cada venta usa el
        coste medio ponderado; el criterio FIFO está en Fiscalidad. Las ejecuciones parciales de una misma orden (mismo
        día y una sola comisión) se muestran juntas, con el precio medio de la orden. El ID son los últimos 8 caracteres
        del <i> transaction_id</i> del CSV.
      </p>
    </div>
  );
}
