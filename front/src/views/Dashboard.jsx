import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Flash, Icon, Kind, Pill, Seg } from '../components/ui.jsx';
import { StepArea, Lines, RankBars, Treemap } from '../charts.jsx';
import { investedSeries, allocation, monthlyDividends, sum } from '../lib/calc.js';
import { prepare, periodStats, gainBetween } from '../lib/perf.js';
import { useTween } from '../hooks.js';
import { country, classLabel, region, sector, industry, currency, exchange } from '../lib/countries.js';
import { eur, eurS, pct, pctS, sign, date, dateLong, qty, num } from '../lib/format.js';

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
/** Mini-gráfica sin ejes: línea (values) o barras (bars). */
const Spark = ({ values, bars, tone = '' }) => {
  const w = 120, hgt = 34, vs = bars ?? values ?? [];
  if (vs.length < 2) return null;
  let lo = Math.min(...vs), hi = Math.max(...vs);
  if (bars) lo = Math.min(0, lo);
  const Y = (v) => hgt - 2 - ((v - lo) / (hi - lo || 1)) * (hgt - 4);
  if (bars) {
    const bw = w / vs.length;
    return (
      <svg className="spark" viewBox={`0 0 ${w} ${hgt}`} aria-hidden="true">
        {vs.map((v, i) => <rect key={i} x={i * bw + 1} y={Y(v)} width={Math.max(1, bw - 2)} height={Math.max(1, hgt - 2 - Y(v))} rx="1.5" />)}
      </svg>
    );
  }
  const d = vs.map((v, i) => `${i ? 'L' : 'M'}${((i / (vs.length - 1)) * w).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  return (
    <svg className={`spark ${tone}`} viewBox={`0 0 ${w} ${hgt}`} preserveAspectRatio="none" aria-hidden="true">
      <path className="spark-a" d={`${d}L${w},${hgt}L0,${hgt}Z`} />
      <path className="spark-l" d={d} />
    </svg>
  );
};
/** Indicador compacto: cifra, explicación y mini-gráfica; lleva a su sección. */
const Kpi = ({ label, value, sub, tone = '', spark, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="kpi" type={onClick ? 'button' : undefined} onClick={onClick}>
      <span className="kpi-l">{label}</span>
      <b className={`kpi-v ${tone}`}>{value}</b>
      {sub && <small className="kpi-s">{sub}</small>}
      {spark}
    </Tag>
  );
};

const Chg = ({ n, p, children }) => (
  <span className={`chg ${sign(n)}`}>
    <span aria-hidden="true">{n >= 0 ? '▲' : '▼'}</span> {eurS(n)}{p != null && <> · {pctS(p)}</>} <em>{children}</em>
  </span>
);

export default function Dashboard({ a, hist, histProgress, flt, cash, meta, onOpen, go }) {
  const [by, setBy] = useState('pos');
  const [map, setMap] = useState(false);
  const [span, setSpan] = useState('day');
  const [range, setRange] = useState('ytd');
  const [mode, setMode] = useState('value');
  const [hover, setHover] = useState(null); // índice del día bajo el cursor (en el histórico completo)
  const start = rangeStart(range);
  const none = a.priced.length === 0;
  const heroVal = useTween(none ? null : a.val);

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
  // Lo que cada valor ha sumado o restado en total: los tres mejores y los tres peores.
  const contrib = useMemo(() => {
    const all = [...a.o.map((x) => ({ p: x.p, t: (x.pl ?? 0) + x.real + x.div })), ...a.c.map((x) => ({ p: x.p, t: x.real + x.div }))]
      .filter((x) => Math.abs(x.t) >= 0.005).sort((x, y) => y.t - x.t);
    return all.length <= 6 ? all : [...all.slice(0, 3), ...all.slice(-3)];
  }, [a.o, a.c]);

  // --- indicadores bajo la gráfica ---
  const kpis = useMemo(() => {
    if (none) return [];
    const out = [];
    // Resultado total: latente + realizado + dividendos, con la evolución del valor de los últimos 6 meses.
    const tail = h ? h.v.slice(-180).filter((_, i, l) => i % 3 === 0 || i === l.length - 1) : null;
    out.push({ key: 'total', label: 'Resultado total', value: eurS(a.total), tone: sign(a.total), sub: 'latente + realizado + dividendos',
      spark: tail && <Spark values={tail} tone={sign(a.total)} />, onClick: () => go('posiciones') });
    // Dividendos de los últimos 12 meses, por mes.
    const months = monthlyDividends(a.dv).slice(-12);
    const cut = new Date(); cut.setFullYear(cut.getFullYear() - 1);
    const last = a.dv.filter((x) => x.d >= cut.toISOString().slice(0, 10));
    out.push({ key: 'div', label: 'Dividendos 12 meses', value: eur(sum(last, (x) => x.net)), sub: `${last.length} ${last.length === 1 ? 'cobro' : 'cobros'} netos`,
      spark: months.length > 1 && <Spark bars={months.map((m) => m.v)} />, onClick: () => go('dividendos') });
    // Frente al MSCI World en el periodo elegido, con las mismas aportaciones.
    const world = st?.bench.find((b) => b.mwr != null);
    if (world && st.mwr != null) {
      const diff = st.mwr - world.mwr;
      out.push({ key: 'bench', label: `Frente al ${world.name}`, value: `${diff >= 0 ? '+' : '−'}${num(Math.abs(diff))} p. p.`, tone: sign(diff),
        sub: `${RANGE_NAME[range]}: tú ${pctS(st.mwr)} · índice ${pctS(world.mwr)}`, onClick: () => setMode('perf') });
    }
    // El mejor del día (si hay cotización de la sesión) o, si no, el efectivo.
    const movers = a.priced.filter((x) => x.dayPct != null).sort((x, y) => y.dayPct - x.dayPct);
    if (movers.length) {
      const b = movers[0];
      out.push({ key: 'best', label: `Mejor ${dayLabel}`, value: b.p.name, sub: `${pctS(b.dayPct)} · ${eurS(b.day)}`, tone: 'name', onClick: () => onOpen(b.p.isin) });
    } else if (cash) {
      out.push({ key: 'cash', label: 'Efectivo', value: eur(cash.balance), sub: `${pct((cash.balance / (a.val + cash.balance)) * 100)} del patrimonio`, onClick: () => go('efectivo') });
    }
    return out;
  }, [none, h, a.total, a.dv, a.priced, a.val, st, range, cash, dayLabel, go, onOpen]);

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
      // Resultado acumulado sobre el capital medio del periodo, para ti y para cada índice con tus mismas
      // aportaciones: el último punto de cada línea es la rentabilidad de la tarjeta de abajo.
      const rel = (g) => (st.avg > 0 ? (g / st.avg) * 100 : 0);
      const mineG = x.map((_, i) => gainBetween(h, st.i0, i + from));
      const mine = mineG.map(rel);
      const bs = st.bench.filter((b) => b.g).map((b, k) => ({ key: b.key, name: b.name, cls: `b${k + 1}`, g: b.g, values: b.g.map(rel) }));
      chart = (
        <Lines x={x} height={280} base={0} label="Resultado acumulado frente a los índices con las mismas aportaciones" onHover={(i) => setHover(i == null ? null : i + from)}
          series={[{ key: 'me', values: mine, cls: 'me' }, ...bs]}
          tip={(i) => (
            <>
              <small>{dateLong(x[i])}</small>
              <b>{pctS(mine[i])}</b>
              <small>Tu cartera {eurS(mineG[i])}</small>
              {bs.map((b) => b.values[i] != null && <small key={b.key}>{b.name} {pctS(b.values[i])} · {eurS(b.g[i])}</small>)}
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
            : <Flash value={none ? null : a.val} as="div" className="hero-v">{none ? '—' : eur(heroVal)}</Flash>}
          {/* Al señalar un día de la gráfica la cabecera conserva su altura: lo de siempre se
              oculta sin quitarlo y la línea de ese día se pinta encima. Si cambiara de altura,
              la gráfica se movería bajo el cursor. */}
          <div className={`hero-sw ${hv ? 'hovering' : ''}`}>
            <div className="hero-base">
              {none ? (
                <p className="mu">Faltan los precios actuales para calcular el valor y el resultado.</p>
              ) : (
                <div className="hero-d">
                  {st && <Chg n={st.gain} p={st.mwr}>{RANGE_NAME[range]}</Chg>}
                  {hasDay && <Chg n={a.day} p={a.dayPct}>{dayLabel}</Chg>}
                  {!st && <Chg n={a.pl} p={a.plp}>desde la compra</Chg>}
                </div>
              )}
              {a.missing > 0 && !none && (
                <button type="button" className="warn" onClick={() => go('posiciones')} tabIndex={hv ? -1 : undefined}>
                  <Icon name="alert" size={15} />
                  {a.missing} {a.missing === 1 ? 'posición sin precio no cuenta' : 'posiciones sin precio no cuentan'} en el valor
                </button>
              )}
            </div>
            {hv && <div className="hero-d hero-over"><Chg n={hv.gain}>{RANGE_NAME[range]} hasta ese día</Chg></div>}
          </div>
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
              : <span className="mu" role="status">{loading
                ? histProgress?.total
                  ? `Descargando cotizaciones históricas: ${histProgress.done} de ${histProgress.total}…`
                  : 'Reconstruyendo el histórico…'
                : 'Capital invertido'}</span>}
            <Seg options={RANGES} value={range} onChange={setRange} label="Periodo" />
          </div>
          {legend && (
            <ul className="legend">
              {legend.map(([k, name, cls]) => <li key={k}><i className={`sw ${cls}`} />{name}</li>)}
            </ul>
          )}
        </section>

        {kpis.length > 0 && (
          <div className="kpis-row">
            {kpis.map(({ key, ...k }) => <Kpi key={key} {...k} />)}
          </div>
        )}

        {st ? (
          <Card title={`Rentabilidad ${RANGE_NAME[range]}`}
            sub={`${start ? `Desde el ${date(start)}` : `Desde el ${date(h.d[0])}`} · ${per.B.length} compras, ${per.S.length} ventas, ${per.D.length} dividendos`}>
            <div className="perf">
              <div><span className="stat-l">Resultado</span><b className={`stat-v ${sign(st.gain)}`}>{eurS(st.gain)}</b></div>
              <div><span className="stat-l">Rentabilidad</span><b className={`stat-v ${sign(st.gain)}`}>{st.mwr != null ? pctS(st.mwr) : '—'}</b></div>
              <div><span className="stat-l">Caída máxima</span><b className="stat-v">{pct(st.mdd)}</b></div>
            </div>
            <h3 className="kv-h">Movimientos</h3>
            <div className="kvs">
              <Line label="Valor al inicio" value={eur(st.v0)} />
              <Line label="Aportaciones netas" hint="compras − ventas" value={eurS(st.contrib)} onClick={() => go('operaciones')} />
              <Line label="Dividendos cobrados" value={eur(st.divs)} onClick={() => go('dividendos')} />
              <Line label="Realizado en ventas" value={eurS(per.real)} tone={sign(per.real)} onClick={() => go('fiscalidad')} />
              <Line label="Comisiones pagadas" value={eur(per.fees)} onClick={() => go('operaciones')} />
              <Line label="Valor al final" value={eur(st.v1)} />
            </div>

            {st.bench.some((b) => b.mwr != null || b.r != null) && (
              <>
                <h3 className="kv-h">Frente a los índices</h3>
                <table className="cmp">
                  <thead>
                    <tr><th scope="col"><span className="sr">Cartera o índice</span></th><th scope="col">Con tus aportaciones</th><th scope="col">Por tiempo</th></tr>
                  </thead>
                  <tbody>
                    <tr className="cmp-me">
                      <th scope="row">Tu cartera</th>
                      <td className={sign(st.mwr ?? 0)}>{st.mwr != null ? pctS(st.mwr) : '—'}</td>
                      <td className={sign(st.twr)}>{pctS(st.twr)}</td>
                    </tr>
                    {st.bench.map((b) => (
                      <tr key={b.key}>
                        <th scope="row">
                          {b.name}
                          {b.mwr != null && <small>{st.gain >= b.gain ? 'Lo bates por' : 'Te bate por'} {eur(Math.abs(st.gain - b.gain))}</small>}
                        </th>
                        <td>{b.mwr != null ? pctS(b.mwr) : '—'}</td>
                        <td>{b.r != null ? pctS(b.r) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            {(st.vol != null || st.best) && (
              <>
                <h3 className="kv-h">Riesgo</h3>
                <div className="kvs">
                  {st.vol != null && <Line label="Volatilidad anualizada" hint="cuánto se mueve tu cartera de un día a otro" value={pct(st.vol)} />}
                  {st.ratio != null && <Line label="Rentabilidad por unidad de riesgo" hint="por encima de 1 es buena" value={num(st.ratio)} tone={sign(st.ratio)} />}
                  {st.best && <Line label="Mejor y peor día" hint={`${date(st.best.d)} y ${date(st.worst.d)}`} value={`${pctS(st.best.r)} / ${pctS(st.worst.r)}`} />}
                </div>
              </>
            )}

            {hist.unpriced.length > 0 && (
              <p className="note">{hist.unpriced.join(', ')} no cotiza: su valor pasado se estima en línea recta entre la compra y las valoraciones que anotes en su ficha.</p>
            )}
            <details className="how">
              <summary>Cómo se calcula</summary>
              <p className="note">
                Resultado = valor final − valor inicial − aportaciones + dividendos. «Con tus aportaciones» divide ese resultado
                entre el capital medio que has tenido invertido, y la de cada índice se calcula igual: invirtiendo en él el
                mismo dinero los mismos días; la gráfica de rentabilidad dibuja ese resultado acumulado. «Por tiempo»
                (ponderada por tiempo) hace que cada día pese igual, hubiera 100 € o 100.000 €: una mala racha con poco
                capital la hunde aunque apenas te costara euros. La rentabilidad por unidad de riesgo es la anualizada
                dividida entre la volatilidad.
              </p>
            </details>
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
          <div className="alloc-v">
            <Seg options={[['bars', 'Barras'], ['map', 'Mapa']]} value={map ? 'map' : 'bars'} onChange={(v) => setMap(v === 'map')} label="Forma de ver la distribución" />
            {map && <span className="mu">El tamaño es el peso; el color, la rentabilidad desde la compra (de −30 % a +30 %)</span>}
          </div>
          {!alloc.length ? <Empty>Hacen falta precios para calcular los pesos.</Empty> : map
            ? <Treemap items={(by === 'pos' ? allocation(a.priced, (p) => p.isin, 99, (p) => p.name) : alloc).map((r) => ({
                key: r.key, label: r.label, v: r.v, plp: r.plp, right: `${pct(r.w)} · ${pctS(r.plp)}`, sub: eur(r.v), w2: pct(r.w),
                onClick: by === 'pos' && !r.other ? () => onOpen(r.isin) : undefined,
              }))} />
            : <RankBars rows={alloc.map((r) => ({
                key: r.key, label: r.label, w: r.w, other: r.other, right: pct(r.w),
                sub: by === 'pos' || r.other ? eur(r.v) : `${eur(r.v)} · ${r.n} ${r.n === 1 ? 'valor' : 'valores'}`,
                onClick: by === 'pos' && !r.other ? () => onOpen(r.isin) : undefined,
              }))} />}
        </Card>
      </div>

      <aside className="dash-side">
        {cash && flt === 'all' && !none && (
          <Card title="Patrimonio">
            <div className="kvs">
              <Line label="Cartera" value={eur(a.val)} />
              <Line label="Efectivo en la cuenta" value={eur(cash.balance)} onClick={() => go('efectivo')} />
              <Line label="Total" value={eur(a.val + cash.balance)} />
            </div>
          </Card>
        )}
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

        {contrib.length > 1 && (
          <Card title="Qué ha aportado cada valor" sub="Latente + realizado + dividendos, desde el inicio">
            <ul className="rows">
              {contrib.map((x) => (
                <li key={x.p.isin}>
                  <button type="button" onClick={() => onOpen(x.p.isin)}>
                    <Asset p={x.p}>{x.p.open ? 'En cartera' : 'Cerrada'}</Asset>
                    <span className="row-r"><span className={`row-v ${sign(x.t)}`}>{eurS(x.t)}</span></span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}

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
