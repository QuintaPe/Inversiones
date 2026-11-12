import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Flash, Icon, Kind, Pill, Seg } from '../components/ui.jsx';
import { StepArea, RankBars } from '../charts.jsx';
import { investedSeries, allocation } from '../lib/calc.js';
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
const RANGE_NAME = { mtd: 'este mes', ytd: 'este año', 3: 'últimos 3 meses', 6: 'últimos 6 meses', 12: 'último año' };

/** Primer día del periodo (AAAA-MM-DD, hora local) o null para todo el histórico. */
function rangeStart(range) {
  if (range === 'max') return null;
  const d = new Date();
  if (range === 'mtd') d.setDate(1);
  else if (range === 'ytd') d.setMonth(0, 1);
  else d.setMonth(d.getMonth() - Number(range));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const isToday = (iso) => iso && new Date(iso).toDateString() === new Date().toDateString();

/** Recorta la serie desde una fecha, conservando el valor con el que se entra al tramo. */
function clip(series, start) {
  if (!start || series.length < 2) return series;
  const from = Date.parse(`${start}T00:00:00Z`);
  if (series[0].t >= from) return series;
  const before = series.filter((p) => p.t < from).at(-1);
  return [{ ...before, t: from }, ...series.filter((p) => p.t >= from)];
}

const Line = ({ label, value, tone = '', onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag className="kv" type={onClick ? 'button' : undefined} onClick={onClick}>
      <span>{label}</span>
      <b className={tone}>{value}</b>
      {onClick && <Icon name="chevron" size={16} />}
    </Tag>
  );
};

export default function Dashboard({ a, meta, onOpen, go }) {
  const [by, setBy] = useState('pos');
  const [span, setSpan] = useState('day');
  const [range, setRange] = useState('max');
  const full = useMemo(() => investedSeries(a.vis), [a.vis]);
  const start = rangeStart(range);
  const series = useMemo(() => clip(full, start), [full, start]);
  // Cifras del periodo elegido: salen de las operaciones, así que son exactas.
  const per = useMemo(() => {
    const evs = start ? a.ops.filter((x) => x.d >= start) : a.ops;
    const of = (k) => evs.filter((x) => x.k === k);
    const B = of('B'), S = of('S'), D = of('D');
    const add = (l, f) => l.reduce((t, x) => t + f(x), 0);
    return {
      B, S, D,
      bought: add(B, (x) => x.net), sold: add(S, (x) => x.net),
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

  const none = a.priced.length === 0;
  const hasDay = a.day != null;
  const dayLabel = isToday(a.dayTime) ? 'hoy' : 'última sesión';
  const useDay = span === 'day' && hasDay;
  const list = [...a.o].sort((x, y) => (y.v ?? -1) - (x.v ?? -1));
  const top5 = [...a.priced].sort((x, y) => y.v - x.v).slice(0, 5).reduce((t, x) => t + x.w, 0);
  const nLive = a.priced.filter((x) => x.p.priceSource === 'live').length;

  return (
    <div className="dash">
      <div className="dash-main">
        <section className="hero">
          <span className="eyebrow">Cartera</span>
          <Flash value={none ? null : a.val} as="div" className="hero-v">{none ? '—' : eur(a.val)}</Flash>
          {none ? (
            <p className="mu">Faltan los precios actuales para calcular el valor y el resultado.</p>
          ) : (
            <div className="hero-d">
              {hasDay && (
                <span className={`chg ${sign(a.day)}`}>
                  <span aria-hidden="true">{a.day >= 0 ? '▲' : '▼'}</span> {eurS(a.day)} · {pctS(a.dayPct)} <em>{dayLabel}</em>
                </span>
              )}
              <span className={`chg ${sign(a.pl)}`}>
                <span aria-hidden="true">{a.pl >= 0 ? '▲' : '▼'}</span> {eurS(a.pl)} · {pctS(a.plp)} <em>desde la compra</em>
              </span>
            </div>
          )}
          {a.missing > 0 && !none && (
            <button type="button" className="warn" onClick={() => go('posiciones')}>
              <Icon name="alert" size={15} />
              {a.missing} {a.missing === 1 ? 'posición sin precio no cuenta' : 'posiciones sin precio no cuentan'} en el valor
            </button>
          )}
        </section>

        <section className="chart-block">
          {series.length > 1
            ? <StepArea bare points={series} height={260} label="Evolución del capital invertido"
                tip={(p) => <><small>{dateLong(p.t)}</small><b>{eur(p.v)}</b></>} />
            : <Empty>Sin operaciones todavía.</Empty>}
          <div className="chart-f">
            <span className="mu">Capital invertido{start && <> · <b className="chart-d">{eurS(per.delta)}</b> {RANGE_NAME[range]}</>}</span>
            <Seg options={RANGES} value={range} onChange={setRange} label="Periodo del gráfico" />
          </div>
        </section>

        {start ? (
          <Card title={`Periodo: ${RANGE_NAME[range]}`} sub={`Desde el ${date(start)} · ${per.B.length} compras, ${per.S.length} ventas, ${per.D.length} dividendos`}>
            <div className="kvs">
              <Line label="Capital invertido neto" value={eurS(per.delta)} />
              <Line label="Compras" value={eur(per.bought)} onClick={() => go('operaciones')} />
              <Line label="Ventas (cobrado neto)" value={eur(per.sold)} onClick={() => go('operaciones')} />
              <Line label="Realizado en ventas" value={eurS(per.real)} tone={sign(per.real)} onClick={() => go('fiscalidad')} />
              <Line label="Dividendos netos" value={eur(per.div)} onClick={() => go('dividendos')} />
              <Line label="Realizado + dividendos" value={eurS(per.real + per.div)} tone={sign(per.real + per.div)} />
              <Line label="Comisiones pagadas" value={eur(per.fees)} onClick={() => go('operaciones')} />
            </div>
            <p className="note">
              El resultado latente no se puede dar por periodo: haría falta el valor de la cartera al inicio, y no se
              guarda histórico de precios. El latente actual es {none ? '—' : eurS(a.pl)}.
            </p>
          </Card>
        ) : (
          <Card title="Resultado" sub="Todo el histórico">
            <div className="kvs">
              <Line label="Capital invertido" value={eur(a.cost)} onClick={() => go('posiciones')} />
              <Line label="Resultado latente" value={none ? '—' : eurS(a.pl)} tone={none ? '' : sign(a.pl)} onClick={() => go('posiciones')} />
              <Line label="Realizado en ventas" value={eurS(a.real)} tone={sign(a.real)} onClick={() => go('fiscalidad')} />
              <Line label="Dividendos netos" value={eur(a.divN)} onClick={() => go('dividendos')} />
              <Line label="Resultado total" value={eurS(a.total)} tone={sign(a.total)} />
              <Line label="Comisiones pagadas" value={eur(a.feeT)} onClick={() => go('operaciones')} />
            </div>
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
