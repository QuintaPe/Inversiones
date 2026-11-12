import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Flash, Icon, Kind, Pill, Seg } from '../components/ui.jsx';
import { StepArea, Lines, RankBars } from '../charts.jsx';
import { investedSeries, allocation } from '../lib/calc.js';
import { prepare, periodStats, gainBetween } from '../lib/perf.js';
import { country, classLabel, region, sector, industry, currency, exchange } from '../lib/countries.js';
import { eur, eurS, pct, pctS, sign, date, dateLong, qty } from '../lib/format.js';

const ALLOC = [
  ['pos', 'Posición'], ['sector', 'Sector'], ['industry', 'Industria'], ['country', 'País'],
  ['region', 'Región'], ['currency', 'Divisa'], ['exchange', 'Bolsa'], ['cls', 'Tipo'],
];
const ALLOC_KEY = {
  sector, industry, currency, exchange,
  country: (p) => country(p.isin), region: (p) => region(p.isin), cls: (p) => classLabel(p.cls),
};
const ALLOC_NOTE = {
  sector: 'Sector de cada empresa; los ETF y fondos van aparte',
  industry: 'Industria de cada empresa, tal como la nombra la fuente (en inglés)',
  country: 'Por país del ISIN (en ETF y fondos, su domicilio)',
  region: 'Por región del país del ISIN',
  currency: 'Divisa en la que cotiza cada valor',
  exchange: 'Bolsa de la que se toma la cotización',
};
const RANGES = [['mtd', 'MTD'], ['3', '3M'], ['6', '6M'], ['ytd', 'YTD'], ['12', '1A'], ['max', 'Máx']];
const RANGE_NAME = { mtd: 'este mes', ytd: 'este año', 3: 'en 3 meses', 6: 'en 6 meses', 12: 'en un año', max: 'desde el inicio' };
const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

/** Primer día del periodo (AAAA-MM-DD, hora local) o null para todo el histórico. */
function rangeStart(range) {
  if (range === 'max') return null;
  const d = new Date();
  if (range === 'mtd') d.setDate(1);
  else if (range === 'ytd') d.setMonth(0, 1);
  else d.setMonth(d.getMonth() - Number(range));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Recorta la serie desde una fecha, conservando el valor con el que se entra al tramo. */
function clip(series, start) {
  if (!start || series.length < 2) return series;
  const from = Date.parse(`${start}T00:00:00Z`);
  if (series[0].t >= from) return series;
  const before = series.filter((p) => p.t < from).at(-1);
  return [{ ...before, t: from }, ...series.filter((p) => p.t >= from)];
}

const Line = ({ label, value, tone = '', hint, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="kv" type={onClick ? 'button' : undefined} onClick={onClick}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <b className={tone}>{value}</b>
      {onClick && <Icon name="chevron" size={16} />}
    </Tag>
  );
};
const Chg = ({ n, p, children }) => (
  <span className={`chg ${sign(n)}`}>
    <span aria-hidden="true">{n >= 0 ? '▲' : '▼'}</span> {eurS(n)}{p != null && <> · {pctS(p)}</>} <em>{children}</em>
  </span>
);

export default function Dashboard({ a, hist, flt, meta, onOpen, go }) {
  const [by, setBy] = useState('pos');
  const [span, setSpan] = useState('day');
  const [range, setRange] = useState('ytd');
  const [mode, setMode] = useState('value');
  const [hover, setHover] = useState(null); // índice del día bajo el cursor (en el histórico completo)
  const start = rangeStart(range);
  const none = a.priced.length === 0;

  // El histórico es de toda la cartera: solo se usa sin filtro de tipo de activo.
  const h = useMemo(() => (hist && flt === 'all' ? prepare(hist) : null), [hist, flt]);
  const st = useMemo(() => (h ? periodStats(h, start) : null), [h, start]);
  const loading = hist === undefined && flt === 'all';

  // --- sin histórico: capital invertido, como antes ---
  const full = useMemo(() => investedSeries(a.vis), [a.vis]);
  const series = useMemo(() => clip(full, start), [full, start]);
  const per = useMemo(() => {
    const evs = start ? a.ops.filter((x) => x.d >= start) : a.ops;
    const of = (k) => evs.filter((x) => x.k === k);
    const add = (l, f) => l.reduce((t, x) => t + f(x), 0);
    const B = of('B'), S = of('S'), D = of('D');
    return {
      B, S, D, bought: add(B, (x) => x.net), sold: add(S, (x) => x.net),
      real: add(S, (x) => x.re), div: add(D, (x) => x.net), fees: add(evs, (x) => x.fee || 0),
      delta: series.length > 1 ? series.at(-1).v - series[0].v : 0,
    };
  }, [a.ops, start, series]);

  const alloc = useMemo(() => {
    if (by !== 'pos') return allocation(a.priced, ALLOC_KEY[by]);
    // Por posición se agrupa por ISIN; si dos comparten nombre se distinguen con el final del ISIN.
    const names = a.priced.map((x) => x.p.name);
    const dup = new Set(names.filter((n, i) => names.indexOf(n) !== i));
    return allocation(a.priced, (p) => p.isin, 8, (p) => (dup.has(p.name) ? `${p.name} ·${p.isin.slice(-4)}` : p.name));
  }, [a.priced, by]);

  const hasDay = a.day != null;
  const dayLabel = isToday(a.dayTime) ? 'hoy' : 'última sesión';
  const useDay = span === 'day' && hasDay;
  const list = [...a.o].sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
  const top5 = [...a.priced].sort((x, y) => y.v - x.v).slice(0, 5).reduce((t, x) => t + x.w, 0);
  const nLive = a.priced.filter((x) => x.p.priceSource === 'live').length;

  // --- gráfica con histórico ---
  let chart = null, legend = null;
  if (h && st) {
    const from = st.first, x = h.t.slice(from);
    if (mode === 'value') {
      chart = (
        <Lines x={x} height={280} label="Valor de la cartera" onHover={(i) => setHover(i == null ? null : i + from)}
          series={[
            { key: 'v', values: h.v.slice(from), cls: st.gain >= 0 ? 'up' : 'down', area: true },
            { key: 'c', values: h.cost.slice(from), cls: 'muted', step: true },
          ]}
          tip={(i) => <><small>{dateLong(x[i])}</small><b>{eur(h.v[i + from])}</b><small>invertido {eur(h.cost[i + from])}</small></>} />
      );
      legend = [['up', 'Valor', st.gain >= 0 ? 'up' : 'down'], ['muted', 'Capital invertido', 'muted']];
    } else {
      const idx0 = st.i0 < 0 ? 100 : h.idx[st.i0];
      const mine = h.idx.slice(from).map((v) => (v / idx0 - 1) * 100);
      const bs = h.benchmarks.map((b, k) => {
        const base = b.c[st.bench[k].from];
        return { key: b.key, name: b.name, cls: `b${k + 1}`, values: b.c.slice(from).map((c, i) => (c != null && base && i + from >= st.bench[k].from ? (c / base - 1) * 100 : null)) };
      });
      chart = (
        <Lines x={x} height={280} base={0} label="Rentabilidad frente a índices" onHover={(i) => setHover(i == null ? null : i + from)}
          series={[{ key: 'me', values: mine, cls: 'me' }, ...bs]}
          tip={(i) => (
            <>
              <small>{dateLong(x[i])}</small>
              <b>{pctS(mine[i])}</b>
              {bs.map((b) => b.values[i] != null && <small key={b.key}>{b.name} {pctS(b.values[i])}</small>)}
            </>
          )} />
      );
      legend = [['me', 'Tu cartera', 'me'], ...bs.map((b) => [b.key, b.name, b.cls])];
    }
  }
  const hv = h && hover != null ? { v: h.v[hover], d: h.d[hover], gain: gainBetween(h, st.i0, hover) } : null;

  return (
    <div className="dash">
      <div className="dash-main">
        <section className="hero">
          <span className="eyebrow">{hv ? dateLong(Date.parse(`${hv.d}T00:00:00Z`)) : 'Cartera'}</span>
          {hv
            ? <div className="hero-v">{eur(hv.v)}</div>
            : <Flash value={none ? null : a.val} as="div" className="hero-v">{none ? '—' : eur(a.val)}</Flash>}
          {none ? (
            <p className="mu">Faltan los precios actuales para calcular el valor y el resultado.</p>
          ) : hv ? (
            <div className="hero-d"><Chg n={hv.gain}>{RANGE_NAME[range]} hasta ese día</Chg></div>
          ) : (
            <div className="hero-d">
              {st && <Chg n={st.gain} p={st.mwr}>{RANGE_NAME[range]}</Chg>}
              {hasDay && <Chg n={a.day} p={a.dayPct}>{dayLabel}</Chg>}
              {!st && <Chg n={a.pl} p={a.plp}>desde la compra</Chg>}
            </div>
          )}
          {a.missing > 0 && !none && !hv && (
            <button type="button" className="warn" onClick={() => go('posiciones')}>
              <Icon name="alert" size={15} />
              {a.missing} {a.missing === 1 ? 'posición sin precio no cuenta' : 'posiciones sin precio no cuentan'} en el valor
            </button>
          )}
        </section>

        <section className="chart-block">
          {chart ?? (loading
            ? <div className="sk" style={{ height: 280 }} aria-label="Reconstruyendo el histórico de la cartera" />
            : series.length > 1
              ? <StepArea bare points={series} height={260} label="Evolución del capital invertido"
                  tip={(p) => <><small>{dateLong(p.t)}</small><b>{eur(p.v)}</b></>} />
              : <Empty>Sin operaciones todavía.</Empty>)}
          <div className="chart-f">
            {chart
              ? <Seg options={[['value', 'Valor'], ['perf', 'Rentabilidad']]} value={mode} onChange={setMode} label="Qué muestra la gráfica" />
              : <span className="mu">{loading ? 'Reconstruyendo el histórico (la primera vez tarda medio minuto)…' : 'Capital invertido'}</span>}
            <Seg options={RANGES} value={range} onChange={setRange} label="Periodo" />
          </div>
          {legend && (
            <ul className="legend">
              {legend.map(([k, name, cls]) => <li key={k}><i className={`sw ${cls}`} />{name}</li>)}
            </ul>
          )}
        </section>

        {st ? (
          <Card title={`Rentabilidad ${RANGE_NAME[range]}`}
            sub={`${start ? `Desde el ${date(start)}` : `Desde el ${date(h.d[0])}`} · ${per.B.length} compras, ${per.S.length} ventas, ${per.D.length} dividendos`}>
            <div className="perf">
              <div><span className="stat-l">Resultado</span><b className={`stat-v ${sign(st.gain)}`}>{eurS(st.gain)}</b></div>
              <div><span className="stat-l">Rentabilidad</span><b className={`stat-v ${sign(st.gain)}`}>{st.mwr != null ? pctS(st.mwr) : '—'}</b></div>
              <div><span className="stat-l">Caída máxima</span><b className="stat-v">{pct(st.mdd)}</b></div>
            </div>
            <div className="kvs">
              <Line label="Valor al inicio" value={eur(st.v0)} />
              <Line label="Aportaciones netas" hint="compras − ventas" value={eurS(st.contrib)} onClick={() => go('operaciones')} />
              <Line label="Dividendos cobrados" value={eur(st.divs)} onClick={() => go('dividendos')} />
              <Line label="Valor al final" value={eur(st.v1)} />
              <Line label="Realizado en ventas" value={eurS(per.real)} tone={sign(per.real)} onClick={() => go('fiscalidad')} />
              <Line label="Comisiones pagadas" value={eur(per.fees)} onClick={() => go('operaciones')} />
              <Line label="Rentabilidad ponderada por tiempo" hint="la comparable con un índice" value={pctS(st.twr)} tone={sign(st.twr)} />
              {st.bench.map((b) => b.r != null && (
                <Line key={b.key} label={`${b.name} en el mismo periodo`}
                  hint={`${st.twr >= b.r ? 'lo bates por' : 'te bate por'} ${pct(Math.abs(st.twr - b.r))}`} value={pctS(b.r)} />
              ))}
            </div>
            <p className="note">
              Resultado = valor final − valor inicial − aportaciones + dividendos. La rentabilidad divide ese resultado
              entre el capital medio que has tenido invertido; la ponderada por tiempo ignora cuándo aportaste.
              {hist.unpriced.length > 0 && ` ${hist.unpriced.join(', ')} no cotiza: su valor pasado se estima en línea recta entre la compra y las valoraciones que anotes en su ficha.`}
            </p>
          </Card>
        ) : (
          <Card title={start ? `Periodo: ${RANGE_NAME[range]}` : 'Resultado'}
            sub={`${start ? `Desde el ${date(start)} · ` : ''}${per.B.length} compras, ${per.S.length} ventas, ${per.D.length} dividendos`}>
            <div className="kvs">
              <Line label="Capital invertido neto" value={start ? eurS(per.delta) : eur(a.cost)} />
              {!start && <Line label="Resultado latente" value={none ? '—' : eurS(a.pl)} tone={none ? '' : sign(a.pl)} onClick={() => go('posiciones')} />}
              <Line label="Compras" value={eur(per.bought)} onClick={() => go('operaciones')} />
              <Line label="Ventas (cobrado neto)" value={eur(per.sold)} onClick={() => go('operaciones')} />
              <Line label="Realizado en ventas" value={eurS(per.real)} tone={sign(per.real)} onClick={() => go('fiscalidad')} />
              <Line label="Dividendos netos" value={eur(per.div)} onClick={() => go('dividendos')} />
              <Line label="Comisiones pagadas" value={eur(per.fees)} onClick={() => go('operaciones')} />
            </div>
            {flt !== 'all' && <p className="note">La rentabilidad por periodo y la gráfica de valor se calculan sobre toda la cartera: elige «Todo» para verlas.</p>}
          </Card>
        )}

        <Card className="alloc" title="Distribución" sub={ALLOC_NOTE[by] ?? (none ? '' : `Las 5 mayores pesan el ${pct(top5)}`)}
          right={<Seg options={ALLOC} value={by} onChange={setBy} label="Agrupar distribución por" />}>
          {alloc.length
            ? <RankBars rows={alloc.map((r) => ({
                key: r.key, label: r.label, w: r.w, other: r.other, right: pct(r.w),
                sub: by === 'pos' || r.other ? eur(r.v) : `${eur(r.v)} · ${r.n} ${r.n === 1 ? 'valor' : 'valores'}`,
                onClick: by === 'pos' && !r.other ? () => onOpen(r.isin) : undefined,
              }))} />
            : <Empty>Hacen falta precios para calcular los pesos.</Empty>}
        </Card>
      </div>

      <aside className="dash-side">
        <Card title="Inversiones" sub={`${a.open.length} posiciones${nLive ? ` · ${nLive} en vivo` : ''}`}
          right={hasDay && <Seg options={[['day', 'Día'], ['total', 'Total']]} value={span} onChange={setSpan} label="Variación mostrada" />}>
          <ul className="rows">
            {list.slice(0, 10).map((x) => {
              const n = useDay ? x.dayPct : x.plp;
              return (
                <li key={x.p.isin}>
                  <button type="button" onClick={() => onOpen(x.p.isin)}>
                    <Asset p={x.p}>{qty(x.p.sh)} uds.</Asset>
                    <span className="row-r">
                      <Flash value={x.v} className="row-v">{x.has ? eur(x.v) : '—'}</Flash>
                      {x.has ? <Pill n={n} /> : <small className="mu">sin precio</small>}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button type="button" className="btn wide soft" onClick={() => go('posiciones')}>{list.length > 10 ? `Ver las ${list.length} posiciones` : 'Ver detalle de posiciones'}</button>
        </Card>

        <Card title="Últimos movimientos" right={<button type="button" className="link" onClick={() => go('operaciones')}>Ver todos</button>}>
          <ul className="rows">
            {a.ops.slice(0, 6).map((x) => (
              <li key={x.id + x.k}>
                <button type="button" onClick={() => onOpen(x.p.isin)}>
                  <Asset p={x.p}>{date(x.d)}</Asset>
                  <span className="row-r">
                    <span className="row-v">{x.k === 'B' ? `−${eur(x.net)}` : eurS(x.net)}</span>
                    <Kind k={x.k} />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      </aside>
    </div>
  );
}
