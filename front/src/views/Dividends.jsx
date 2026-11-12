import { useMemo } from 'react';
import { Asset, Card, Stat, Empty, Th, useSort } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import { monthlyDividends, sum } from '../lib/calc.js';
import { eur, pct, month, date, qty, num } from '../lib/format.js';

export default function Dividends({ a, onOpen }) {
  const months = useMemo(() => monthlyDividends(a.dv), [a.dv]);
  const s = useSort('net');
  const byPos = useMemo(() => {
    const m = {};
    for (const x of a.dv) {
      const r = (m[x.p.isin] ??= { p: x.p, n: 0, g: 0, tax: 0, net: 0, last: x.d });
      r.n++; r.g += x.g; r.tax += x.tax; r.net += x.net;
      if (x.d > r.last) r.last = x.d;
    }
    return Object.values(m).map((r) => ({ ...r, yoc: r.p.open && r.p.cost ? (r.net / r.p.cost) * 100 : null }));
  }, [a.dv]);
  const rows = s.apply(byPos, (r, k) => (k === 'name' ? r.p.name : r[k]));

  if (!a.dv.length) return <div className="card"><Empty>No hay dividendos cobrados en esta vista.</Empty></div>;

  const g = sum(a.dv, (x) => x.g), tax = sum(a.dv, (x) => x.tax);
  const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
  const cutS = cut.toISOString().slice(0, 10);
  const last12 = a.dv.filter((x) => x.d >= cutS);
  const net12 = sum(last12, (x) => x.net);
  // Rentabilidad sobre el coste: solo dividendos de posiciones que sigues teniendo.
  const net12open = sum(last12.filter((x) => x.p.open), (x) => x.net);

  return (
    <div className="stack">
      <div className="card stats five">
        <Stat label="Neto cobrado" value={eur(a.divN)} hint={`${a.dv.length} cobros`} />
        <Stat label="Bruto" value={eur(g)} />
        <Stat label="Retenciones" value={eur(tax)} hint={g ? `${pct((tax / g) * 100)} del bruto` : ''} />
        <Stat label="Últimos 12 meses" value={eur(net12)} hint={`${last12.length} cobros · ${eur(net12 / 12)}/mes`} />
        <Stat label="Rentab. s/ coste" value={a.cost ? pct((net12open / a.cost) * 100) : '—'} hint="neto 12 meses ÷ capital invertido" />
      </div>

      <Card title="Dividendos netos por mes">
        <Columns data={months.map((m) => ({ ...m, label: month(m.key) }))} label="Dividendos netos por mes"
          tip={(d) => <><small>{d.label}</small><b>{eur(d.v)}</b><small>{d.n} {d.n === 1 ? 'cobro' : 'cobros'}</small></>} />
      </Card>

      <div className="card table-card">
        <header className="card-h"><div><h2>Por activo</h2></div></header>
        <table className="tbl">
          <thead>
            <tr>
              <Th id="name" sort={s.sort} onSort={s.onSort} className="l">Activo</Th>
              <Th id="n" sort={s.sort} onSort={s.onSort} className="hide-s">Cobros</Th>
              <Th id="last" sort={s.sort} onSort={s.onSort} className="hide-m">Último</Th>
              <Th id="g" sort={s.sort} onSort={s.onSort} className="hide-s">Bruto</Th>
              <Th id="tax" sort={s.sort} onSort={s.onSort} className="hide-s">Retención</Th>
              <Th id="net" sort={s.sort} onSort={s.onSort}>Neto</Th>
              <Th id="yoc" sort={s.sort} onSort={s.onSort}>S/ coste</Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.p.isin} onClick={() => onOpen(r.p.isin)} tabIndex={0} onKeyDown={(ev) => ev.key === 'Enter' && onOpen(r.p.isin)}>
                <td className="l"><Asset p={r.p} size="sm">{!r.p.open && 'posición cerrada'}</Asset></td>
                <td className="hide-s">{r.n}</td>
                <td className="hide-m">{date(r.last)}</td>
                <td className="hide-s">{eur(r.g)}</td>
                <td className="hide-s">{eur(r.tax)}<small>{r.g ? pct((r.tax / r.g) * 100) : ''}</small></td>
                <td>{eur(r.net)}</td>
                <td>{r.yoc != null ? pct(r.yoc) : <span className="mu">—</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td className="l">Total</td><td className="hide-s">{a.dv.length}</td><td className="hide-m" />
              <td className="hide-s">{eur(g)}</td><td className="hide-s">{eur(tax)}</td><td>{eur(a.divN)}</td><td /></tr>
          </tfoot>
        </table>
      </div>

      <Card title="Todos los cobros">
        <ul className="feed">
          {a.dv.map((x) => (
            <li key={x.id}>
              <button type="button" onClick={() => onOpen(x.p.isin)}>
                <Asset p={x.p} size="sm">{date(x.d)} · {qty(x.sh)} uds. · bruto {num(x.g)} − retención {num(x.tax)}{x.orig && ` · ${x.orig}`}</Asset>
                <span className="feed-a">{eur(x.net)}</span>
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <p className="note">
        «S/ coste» es el neto cobrado en total dividido entre el coste actual de la posición; solo se calcula para
        posiciones abiertas. Los dividendos de acumulación de ETF no generan cobros.
      </p>
    </div>
  );
}
