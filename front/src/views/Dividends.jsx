import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Asset, Card, Stat, Empty, Th, useSort } from '../components/ui.jsx';
import { Columns } from '../charts.jsx';
import { monthlyDividends, sum } from '../lib/calc.js';
import { eur, pct, month, date, qty, num } from '../lib/format.js';

const ym = (d) => d.slice(0, 7);

export default function Dividends({ a, onOpen }) {
  const months = useMemo(() => monthlyDividends(a.dv), [a.dv]);
  // Previsión: repite los pagos por acción del último año con las posiciones de hoy.
  const [fc, setFc] = useState(undefined);
  const openKey = a.open.map((p) => p.isin + p.sh).join();
  useEffect(() => {
    let alive = true;
    api.getDividendForecast().then((r) => alive && setFc(r.forecast)).catch(() => alive && setFc(null));
    return () => { alive = false; };
  }, [openKey]);
  const forecast = useMemo(() => {
    if (!fc) return null;
    const mine = new Set(a.open.map((p) => p.isin));
    const items = fc.items.filter((i) => mine.has(i.isin));
    if (!items.length) return null;
    const gross = sum(items, (i) => i.gross);
    // Retención esperada: la efectiva que ya has tenido en cada valor, o la media de la cartera.
    const hist = {};
    for (const x of a.dv) { const h = (hist[x.p.isin] ??= { g: 0, t: 0 }); h.g += x.g; h.t += x.tax; }
    const tg = sum(a.dv, (x) => x.g), avg = tg ? sum(a.dv, (x) => x.tax) / tg : 0.19;
    const rate = (isin) => (hist[isin]?.g ? hist[isin].t / hist[isin].g : avg);
    const net = sum(items, (i) => i.gross * (1 - rate(i.isin)));
    const by = {};
    for (const i of items) (by[ym(i.d)] ??= { key: ym(i.d), v: 0, n: 0 }).v += i.gross, by[ym(i.d)].n++;
    const now = new Date(), cal = [];
    for (let k = 0; k < 12; k++) {
      const d = new Date(now.getFullYear(), now.getMonth() + k, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      cal.push(by[key] ?? { key, v: 0, n: 0 });
    }
    const today = now.toISOString().slice(0, 10);
    return { gross, net, cal, next: items.filter((i) => i.d >= today).slice(0, 8), n: items.length, valued: sum(a.priced, (x) => x.v) };
  }, [fc, a.open, a.dv, a.priced]);
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

  const forecastCard = forecast && (
    <Card title="Previsión a 12 meses" sub="Si cada empresa repite los pagos por acción de su último año, con lo que tienes hoy">
      <div className="perf">
        <div><span className="stat-l">Bruto estimado</span><b className="stat-v">{eur(forecast.gross)}</b></div>
        <div><span className="stat-l">Neto estimado</span><b className="stat-v">{eur(forecast.net)}</b></div>
        <div><span className="stat-l">Rentab. por dividendo</span><b className="stat-v">{forecast.valued ? pct((forecast.gross / forecast.valued) * 100) : '—'}</b></div>
      </div>
      <Columns data={forecast.cal.map((m) => ({ ...m, label: month(m.key) }))} height={170} label="Dividendos brutos estimados por mes"
        tip={(d) => <><small>{d.label}</small><b>{eur(d.v)}</b><small>{d.n} {d.n === 1 ? 'pago estimado' : 'pagos estimados'}</small></>} />
      <h3 className="sub-h">Próximos pagos estimados</h3>
      <ul className="rows">
        {forecast.next.map((i) => (
          <li key={i.isin + i.d}>
            <button type="button" onClick={() => onOpen(i.isin)}>
              <Asset p={i} size="sm">hacia el {date(i.d)} · {num(i.perShare)} {i.currency} por acción</Asset>
              <span className="row-r"><span className="row-v">{eur(i.gross)}</span><small className="mu">bruto</small></span>
            </button>
          </li>
        ))}
      </ul>
      <p className="note">
        Estimación, no un calendario oficial: las fechas son las de corte del año pasado más un año (el cobro llega después) y
        los importes pueden cambiar. El neto aplica la retención efectiva que ya has tenido en cada valor.
      </p>
    </Card>
  );

  if (!a.dv.length) return <div className="stack">{forecastCard ?? <div className="card"><Empty>No hay dividendos cobrados en esta vista.</Empty></div>}</div>;

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

      {forecastCard}

      <Card title="Dividendos netos por mes" sub="Lo ya cobrado">
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
