import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Asset, Avatar, Card, Empty } from '../components/ui.jsx';
import { Kpi, Spark } from '../components/Kpi.jsx';
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
  const s = { apply: (list) => [...list].sort((x, y) => y.net - x.net) };
  const byPos = useMemo(() => {
    const m = {};
    for (const x of a.dv) {
      const r = (m[x.p.isin] ??= { p: x.p, n: 0, g: 0, tax: 0, net: 0, last: x.d });
      r.n++; r.g += x.g; r.tax += x.tax; r.net += x.net;
      if (x.d > r.last) r.last = x.d;
    }
    return Object.values(m).map((r) => ({ ...r, yoc: r.p.open && r.p.cost ? (r.net / r.p.cost) * 100 : null }));
  }, [a.dv]);
  const rows = s.apply(byPos);

  // Calendario de los próximos 12 meses: importe estimado y quién paga.
  const calendar = useMemo(() => {
    if (!forecast) return null;
    const payers = {};
    for (const i of fc.items) (payers[ym(i.d)] ??= new Map()).set(i.isin, i);
    return forecast.cal.map((m) => ({ ...m, who: [...(payers[m.key]?.values() ?? [])] }));
  }, [forecast, fc]);
  const [all, setAll] = useState(false);
  const [allRows, setAllRows] = useState(false);

  // Mientras llega la previsión se reserva su sitio, para que la página no salte al aparecer.
  const loadingFc = fc === undefined;
  const calSkeleton = loadingFc && (
    <section className="card" aria-busy="true" aria-label="Cargando la previsión de dividendos">
      <span className="sk sk-t" style={{ width: 260, height: 20 }} />
      <span className="sk sk-t" style={{ width: 380, height: 13, marginTop: 8 }} />
      <div className="divcal sk-cal">{Array.from({ length: 12 }, (_, i) => <span key={i} className="sk" />)}</div>
      <span className="sk sk-t" style={{ width: 120, height: 12, margin: '26px 0 10px' }} />
      <ul className="sk-rows">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i}><span className="sk sk-av" /><span><span className="sk sk-t" style={{ width: 140, height: 14 }} /><span className="sk sk-t" style={{ width: 220, height: 11, marginTop: 6 }} /></span><span className="sk sk-t" style={{ width: 70, height: 14, marginLeft: 'auto' }} /></li>
        ))}
      </ul>
      <span className="sk sk-t" style={{ width: '70%', height: 12, marginTop: 14 }} />
    </section>
  );
  const calCard = calendar ? (
    <Card title="Calendario de los próximos 12 meses" sub="Si cada empresa repite los pagos por acción de su último año, con lo que tienes hoy">
      <ol className="divcal">
        {calendar.map((m, i) => (
          <li key={m.key} className={`${m.v ? 'has' : ''} ${i === 0 ? 'now' : ''}`}>
            <span className="divcal-m">{month(m.key)}</span>
            <b className="divcal-v">{m.v ? eur(m.v) : '—'}</b>
            <span className="divcal-w">
              {m.who.slice(0, 4).map((w) => <Avatar key={w.isin} p={w} size="xs" />)}
              {m.who.length > 4 && <small>+{m.who.length - 4}</small>}
            </span>
          </li>
        ))}
      </ol>
      {forecast.next.length > 0 && (
        <>
          <h3 className="kv-h">Próximos pagos</h3>
          <ul className="rows">
            {forecast.next.slice(0, 5).map((i) => (
              <li key={i.isin + i.d}>
                <button type="button" onClick={() => onOpen(i.isin)}>
                  <Asset p={i} size="sm">hacia el {date(i.d)} · {num(i.perShare)} {i.currency} por acción</Asset>
                  <span className="row-r"><span className="row-v">{eur(i.gross)}</span><small className="mu">bruto</small></span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="note">
        Estimación, no un calendario oficial: las fechas son las de corte del año pasado más un año (el cobro llega después) y
        los importes pueden cambiar. Los importes son brutos.
      </p>
    </Card>
  ) : null;

  if (!a.dv.length) return <div className="stack">{calCard ?? calSkeleton ?? <div className="card"><Empty>No hay dividendos cobrados en esta vista.</Empty></div>}</div>;

  const g = sum(a.dv, (x) => x.g), tax = sum(a.dv, (x) => x.tax);
  const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
  const cutS = cut.toISOString().slice(0, 10);
  const last12 = a.dv.filter((x) => x.d >= cutS);
  const net12 = sum(last12, (x) => x.net);
  // Rentabilidad sobre el coste: solo dividendos de posiciones que sigues teniendo.
  const net12open = sum(last12.filter((x) => x.p.open), (x) => x.net);
  const top = Math.max(...rows.map((r) => r.net), 1);
  const kpis = [
    { key: 'all', label: 'Neto cobrado', value: eur(a.divN), sub: `${a.dv.length} cobros desde el inicio`, spark: months.length > 1 && <Spark bars={months.slice(-24).map((m) => m.v)} /> },
    { key: 'tax', label: 'Retenciones', value: eur(tax), sub: g ? `${pct((tax / g) * 100)} del bruto (${eur(g)})` : '' },
    loadingFc && { key: 'fc', label: 'Previsión 12 meses', value: <span className="sk sk-t" style={{ width: 110, height: 22 }} />, sub: 'calculando…',
      spark: <span className="sk sk-t" style={{ height: 26, marginTop: 'auto', width: '100%' }} /> },
    forecast && { key: 'fc', label: 'Previsión 12 meses', value: eur(forecast.net), sub: `neto · ${eur(forecast.gross)} bruto`, tone: 'gain', spark: <Spark bars={forecast.cal.map((m) => m.v)} /> },
    { key: 'yoc', label: 'Rentab. sobre coste', value: a.cost ? pct((net12open / a.cost) * 100) : '—',
      sub: forecast?.valued ? `por dividendo hoy: ${pct((forecast.gross / forecast.valued) * 100)}` : 'neto 12 meses ÷ invertido' },
  ].filter(Boolean);

  return (
    <div className="stack divs">
      <section className="hero">
        <span className="eyebrow">Dividendos netos en los últimos 12 meses</span>
        <div className="hero-v">{eur(net12)}</div>
        <div className="hero-d">
          <span className="chg"><em>{last12.length} cobros · unos {eur(net12 / 12)} al mes</em></span>
          {forecast && <span className="chg gain">▲ {eur(forecast.net)} <em>previstos en los próximos 12 meses</em></span>}
          {loadingFc && <span className="chg"><span className="sk sk-t" style={{ width: 280, height: '1em', display: 'inline-block', verticalAlign: 'middle' }} aria-hidden="true" /></span>}
        </div>
      </section>

      <div className="kpis-row">
        {kpis.map(({ key, ...k }) => <Kpi key={key} {...k} />)}
      </div>

      {calCard ?? calSkeleton}

      <Card title="Cobrado mes a mes" sub="Dividendos netos ya cobrados">
        <Columns data={months.map((m) => ({ ...m, label: month(m.key) }))} height={240} label="Dividendos netos por mes"
          tip={(d) => <><small>{d.label}</small><b>{eur(d.v)}</b><small>{d.n} {d.n === 1 ? 'cobro' : 'cobros'}</small></>} />
      </Card>

      <Card title="Por activo" sub={`Neto cobrado desde el inicio · ${rows.length} ${rows.length === 1 ? 'valor' : 'valores'}`}>
        <ul className="rank-l two">
          {(allRows ? rows : rows.slice(0, 10)).map((r) => (
            <li key={r.p.isin}>
              <button type="button" onClick={() => onOpen(r.p.isin)}>
                <Asset p={r.p} size="sm">{r.n} {r.n === 1 ? 'cobro' : 'cobros'} · último {date(r.last)}{r.g ? ` · ret. ${pct((r.tax / r.g) * 100)}` : ''}{!r.p.open && ' · cerrada'}</Asset>
                <span className="rank-l-b" aria-hidden="true"><i style={{ width: `${(r.net / top) * 100}%` }} /></span>
                <span className="row-r">
                  <span className="row-v">{eur(r.net)}</span>
                  {r.yoc != null && <small className="mu">{pct(r.yoc)} s/ coste</small>}
                </span>
              </button>
            </li>
          ))}
        </ul>
        {rows.length > 10 && (
          <button type="button" className="fold" aria-expanded={allRows} onClick={() => setAllRows((v) => !v)}>
            {allRows ? 'Ver solo los 10 primeros' : `Ver los ${rows.length}`}
          </button>
        )}
      </Card>

      <section className="card">
        <header className="card-h"><div><h2>Todos los cobros</h2><p>{a.dv.length} cobros · bruto {eur(g)} − retención {eur(tax)}</p></div></header>
        <button type="button" className="fold" aria-expanded={all} onClick={() => setAll((v) => !v)}>
          {all ? 'Ocultar la lista' : 'Ver todos los cobros'}
        </button>
        {all && (
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
        )}
      </section>
      <p className="note">
        «S/ coste» es el neto cobrado en total dividido entre el coste actual de la posición; solo se calcula para
        posiciones abiertas. El neto previsto aplica la retención efectiva que ya has tenido en cada valor. Los
        dividendos de acumulación de ETF no generan cobros.
      </p>
    </div>
  );
}
