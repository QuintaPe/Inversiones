import { useMemo, useState } from 'react';
import { Card, Empty, Search, Seg, Sticky, Tabs } from '../components/ui.jsx';
import { Kpi, Spark } from '../components/Kpi.jsx';
import { Lines, Columns, Diverge } from '../charts.jsx';
import { useParam } from '../router.js';
import { cashHealth, spendOf, incomeOf, investOf } from '../../../shared/cash.js';
import Spending from './Spending.jsx';
import Wealth from './Wealth.jsx';
import { prettyName, categoryOf, isSpend, CAT } from '../lib/categories.js';
import { eur, eurS, pct, sign, date, dateLong, month, compact } from '../lib/format.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthLong = (ym) => { const m = MONTHS[+ym.slice(5, 7) - 1]; return `${m[0].toUpperCase()}${m.slice(1)} de ${ym.slice(0, 4)}`; };
const dec1 = (n) => n.toFixed(1).replace('.', ',');
// Filtros del extracto: cada uno reúne uno o varios conceptos del servidor.
const KINDS = [['all', 'Todo'], ['deposit', 'Ingresos'], ['card', 'Tarjeta'], ['withdrawal', 'Retiradas'], ['invest', 'Inversión'], ['rent', 'Rentas'], ['rest', 'Otros']];
const IN_KIND = { rent: ['dividend', 'interest', 'reward'], rest: ['tax', 'other'] };
const PAGE = 80;
const TABS = { resumen: 'resumen', gastos: 'gastos', movimientos: 'movimientos', analisis: 'analisis', patrimonio: 'patrimonio' };

/** Mapa de gasto: categorías (filas) por mes (columnas); el color, cuánto pesa en su fila. */
function Heatmap({ moves, cats, months }) {
  const grid = {};
  for (const m of moves) {
    const ym = m[0].slice(0, 7);
    if (!(m[1] === 'card' || m[1] === 'withdrawal') || !months.includes(ym)) continue;
    const k = categoryOf(m, cats);
    (grid[k] ??= {})[ym] = (grid[k][ym] ?? 0) - m[2];
  }
  const rows = Object.entries(grid).map(([k, g]) => ({ k, g, total: Object.values(g).reduce((a, b) => a + b, 0) }))
    .filter((r) => r.total > 0.005).sort((a, b) => b.total - a.total);
  if (!rows.length) return null;
  const short = (ym) => month(ym).replace(' de ', ' ');
  return (
    <section className="card table-card heat">
      <header className="card-h"><div><h2>Gasto por categoría y mes</h2><p>Cuanto más intenso, más pesa ese mes dentro de su categoría</p></div></header>
      <div className="heat-x">
        <table className="tbl">
          <thead><tr><th className="l">Categoría</th>{months.map((m) => <th key={m}>{short(m)}</th>)}<th>Total</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const max = Math.max(...Object.values(r.g), 1);
              return (
                <tr key={r.k} className="static" style={{ '--h': CAT[r.k].hue }}>
                  <td className="l"><span className="cat-n"><i aria-hidden="true" />{CAT[r.k].label}</span></td>
                  {months.map((m) => {
                    const v = r.g[m] ?? 0;
                    return <td key={m} className="heat-c" style={{ '--a': `${Math.round(Math.max(0, v / max) * 60)}%` }}>{v > 0.5 ? Math.round(v).toLocaleString('es-ES') : ''}</td>;
                  })}
                  <td><b>{eur(r.total)}</b></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const ORDER = ['deposit', 'withdrawal', 'card', 'invest', 'dividend', 'interest', 'reward', 'tax', 'other'];
const sumOf = (g) => Object.values(g).reduce((t, v) => t + v, 0);

/** Un concepto como barra hacia la derecha (entra dinero) o hacia la izquierda (sale). */
function FlowRow({ label, v, max, total = false }) {
  const w = max ? (Math.abs(v) / max) * 50 : 0;
  return (
    <div className={`flow-r ${total ? 'total' : ''}`}>
      <span className="flow-l">{label}</span>
      <span className="flow-t" aria-hidden="true">
        <i className={v >= 0 ? 'in' : 'out'} style={v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} />
      </span>
      <b className={total ? sign(v) : v >= 0 ? 'gain' : ''}>{eurS(v)}</b>
    </div>
  );
}

/** Mes en curso: lo que llevas ingresado, gastado e invertido, y el gasto frente a tu ritmo habitual. */
function ThisMonth({ h }) {
  const n = h.now;
  const full = h.avgSpend ?? 0;
  const scale = Math.max(full, n.spend, 1);
  const diff = n.pace != null ? n.spend - n.pace : null;
  return (
    <Card title={monthLong(n.month)} sub={`Hasta el ${date(h.asOf)} · día ${n.day} de ${n.daysIn}`}>
      <div className="mon">
        <div className="mon-g">
          <div className="mon-h"><span>Gastado</span><b>{eur(n.spend)}</b></div>
          <div className="mon-t" aria-hidden="true">
            <i className={diff != null && diff > 0 ? 'over' : ''} style={{ width: `${(n.spend / scale) * 100}%` }} />
            {n.pace != null && <em style={{ left: `${(n.pace / scale) * 100}%` }} />}
          </div>
          <small>
            {diff == null ? 'Aún no hay meses completos para comparar.'
              : `${diff > 0 ? 'Vas' : 'Llevas'} ${eur(Math.abs(diff))} ${diff > 0 ? 'por encima' : 'por debajo'} de tu ritmo habitual · media mensual ${eur(full)}`}
          </small>
        </div>
        <dl className="mon-kv">
          <div><dt>Ingresado</dt><dd className={n.income ? 'gain' : ''}>{eur(n.income)}</dd></div>
          <div><dt>{n.invest >= 0 ? 'Invertido' : 'Vendido (neto)'}</dt><dd>{eur(Math.abs(n.invest))}</dd></div>
          <div><dt>Rentas</dt><dd className={n.rent ? 'gain' : ''}>{eur(n.rent)}</dd></div>
        </dl>
      </div>
    </Card>
  );
}

/** Extracto de movimientos de efectivo, por meses y filtrable por tipo. */
function Statement({ moves, labels, year, years, setYear }) {
  const [kind, setKind] = useParam('mov', 'all', Object.fromEntries(KINDS.map(([k]) => [k, k === 'all' ? 'todo' : k])));
  const [q, setQ] = useParam('q', '');
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const ks = kind === 'all' ? null : IN_KIND[kind] ?? [kind];
    const s = q.trim().toLowerCase();
    return moves.filter((m) => (year === 'all' || m[0].startsWith(year)) && (!ks || ks.includes(m[1]))
      && (!s || (m[3] ?? '').toLowerCase().includes(s) || (labels[m[1]] ?? '').toLowerCase().includes(s))).reverse();
  }, [moves, kind, year, q, labels]);
  const groups = [];
  for (const m of rows.slice(0, limit)) {
    const ym = m[0].slice(0, 7);
    if (groups.at(-1)?.ym !== ym) groups.push({ ym, items: [] });
    groups.at(-1).items.push(m);
  }
  const present = new Set(moves.map((m) => m[1]));
  const kinds = KINDS.filter(([k]) => k === 'all' || (IN_KIND[k] ?? [k]).some((x) => present.has(x)));
  return (
    <section className="card st">
      <header className="card-h">
        <div><h2>Extracto</h2><p>{rows.length} {rows.length === 1 ? 'movimiento' : 'movimientos'} · lo más reciente arriba</p></div>
      </header>
      <div className="toolbar">
        <Search value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} placeholder="Buscar comercio, valor o concepto" label="Buscar movimiento" />
        <select aria-label="Año" value={year} onChange={(ev) => { setYear(ev.target.value); setLimit(PAGE); }}>
          <option value="all">Todos los años</option>
          {years.map((y) => <option key={y}>{y}</option>)}
        </select>
      </div>
      <Seg label="Tipo de movimiento" options={kinds} value={kind} onChange={(k) => { setKind(k); setLimit(PAGE); }} />
      {!rows.length && <Empty>No hay movimientos de este tipo en el periodo.</Empty>}
      {groups.map((g) => (
        <div key={g.ym} className="st-m">
          <h3>{monthLong(g.ym)}</h3>
          <ul>
            {g.items.map((m, i) => (
              <li key={`${m[0]}-${i}`}>
                <span className="st-d">{date(m[0])}</span>
                <span className="st-c">{m[3]
                  ? <><b>{prettyName(m[3])}</b> · {m[1] === 'dividend' ? 'Dividendo' : m[1] === 'invest' ? (m[2] < 0 ? 'Compra' : 'Venta') : labels[m[1]] ?? m[1]}</>
                  : labels[m[1]] ?? m[1]}</span>
                <b className={`st-v ${m[2] > 0 ? 'gain' : ''}`}>{eurS(m[2])}</b>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {rows.length > limit && (
        <div className="more"><button type="button" className="btn" onClick={() => setLimit((l) => l + PAGE)}>Mostrar más ({rows.length - limit} restantes)</button></div>
      )}
    </section>
  );
}

export default function Cash({ cash, labels, cats = {}, onCats, budgets = {}, onBudgets, fail, portfolioValue, hist }) {
  const [year, setYear] = useParam('año', 'all');
  const [table, setTable] = useState(false);
  const health = useMemo(() => (cash ? cashHealth(cash) : null), [cash]);
  const [tab, setTab] = useParam('ver', 'resumen', TABS);
  const series = useMemo(() => {
    if (!cash) return null;
    return { t: cash.days.map(([d]) => Date.parse(`${d}T00:00:00Z`)), v: cash.days.map(([, v]) => v) };
  }, [cash]);
  if (cash === undefined) return <div className="sk" style={{ height: 320 }} />;
  if (!cash) {
    return (
      <div className="card">
        <Empty>
          Para reconstruir el efectivo hacen falta todos los movimientos de la cuenta. Vuelve a subir tu CSV: de los
          pagos con tarjeta se guarda el comercio y su categoría, y de las transferencias el nombre de la otra parte; nunca
          el IBAN ni el concepto.
        </Empty>
      </div>
    );
  }
  const years = [...new Set(Object.keys(cash.months).map((m) => m.slice(0, 4)))].sort().reverse();
  const months = Object.entries(cash.months).filter(([m]) => year === 'all' || m.startsWith(year)).sort();
  const totals = {};
  for (const [, m] of months) for (const [k, v] of Object.entries(m)) totals[k] = (totals[k] ?? 0) + v;
  const net = sumOf(totals);
  const per = year === 'all' ? 'desde el inicio' : `en ${year}`;
  const total = portfolioValue + cash.balance;

  // Indicadores del periodo, cada uno con sus importes mes a mes.
  const monthly = (keys, flip = 1) => months.map(([, g]) => flip * keys.reduce((t, k) => t + (g[k] ?? 0), 0));
  const kpis = [
    { key: 'in', label: 'Has ingresado', value: eur(totals.deposit ?? 0), sub: per, bars: monthly(['deposit']) },
    { key: 'inv', label: 'Has invertido', value: eur(-(totals.invest ?? 0)), sub: 'compras − ventas', bars: monthly(['invest'], -1) },
    { key: 'rent', label: 'Rentas cobradas', value: eur((totals.dividend ?? 0) + (totals.interest ?? 0) + (totals.reward ?? 0)), sub: 'dividendos, intereses y premios', bars: monthly(['dividend', 'interest', 'reward']), tone: 'gain' },
    totals.card
      ? { key: 'card', label: 'Gasto con tarjeta', value: eur(-totals.card), sub: per, bars: monthly(['card'], -1) }
      : { key: 'net', label: 'Variación del saldo', value: eurS(net), sub: per, tone: sign(net), bars: months.map(([, g]) => sumOf(g)) },
  ];
  const flows = ORDER.filter((k) => Math.abs(totals[k] ?? 0) >= 0.005).map((k) => ({ k, v: totals[k] }));
  const max = Math.max(...flows.map((f) => Math.abs(f.v)), Math.abs(net), 1);

  return (
    <div className="stack cash">
      <section className="hero hero-split">
        <span className="eyebrow">Efectivo en la cuenta</span>
        <div className="hero-v">{eur(cash.balance)}</div>
        <div className="hero-d">
          {total > 0 && (
            <span className="chg"><em>{pct((cash.balance / total) * 100)} de tu patrimonio · total con la cartera {eur(total)}</em></span>
          )}
          <span className="chg"><em>Movimientos del CSV hasta el {dateLong(series.t.at(-1))}</em></span>
        </div>
      </section>

      <Sticky><Tabs label="Apartado" value={tab} onChange={setTab} items={[['resumen', 'Resumen'], ['gastos', 'Gastos'], ['movimientos', 'Movimientos'], ['analisis', 'Análisis'], ['patrimonio', 'Patrimonio']]} /></Sticky>

      {tab === 'resumen' && (
        <>
        <section className="chart-block">
          <Lines x={series.t} height={220} label="Saldo de efectivo" base={0} scale={compact}
            series={[{ key: 'v', values: series.v, cls: '', step: true, area: true }]}
            tip={(i) => <><small>{dateLong(series.t[i])}</small><b>{eur(series.v[i])}</b></>} />
        </section>

        {health?.months.length > 0 && (() => {
          const last = health.months.map((m) => cash.months[m]);
          const interest = last.reduce((s, m) => s + (m.interest ?? 0), 0);
          const flows = [...health.months, health.now.month].map((m) => ({ key: m, label: month(m), up: incomeOf(cash.months[m]), down: Math.max(0, spendOf(cash.months[m])), inv: investOf(cash.months[m]) }));
          return (
            <>
              <div className="sect-h"><h2>Tu efectivo</h2><span className="mu">últimos {health.months.length === 1 ? 'mes completo' : `${health.months.length} meses completos`}</span></div>
              <div className="kpis-row">
                <Kpi label="Colchón" value={health.cushion != null ? `${dec1(health.cushion)} meses` : '—'}
                  sub={health.cushion != null ? 'de gastos cubiertos con tu saldo' : 'sin gastos con los que comparar'} />
                <Kpi label="Gasto medio al mes" value={eur(health.avgSpend)} sub="tarjeta, retiradas y recibos"
                  spark={last.length > 1 && <Spark bars={last.map((m) => Math.max(0, spendOf(m)))} />} />
                <Kpi label="Tasa de ahorro" value={health.saveRate != null ? pct(health.saveRate) : '—'} tone={health.saveRate != null ? sign(health.saveRate) : ''}
                  sub={health.avgIncome > 0 ? `ahorras ${eur(health.avgIncome - health.avgSpend)} al mes` : 'sin ingresos en estos meses'} />
                <Kpi label="Rentabilidad del efectivo" value={health.yieldPct != null ? `${pct(health.yieldPct)} anual` : '—'} tone={health.yieldPct != null ? 'gain' : ''}
                  sub={interest > 0 ? `${eur(interest)} de intereses sobre tu saldo medio` : 'sin intereses en estos meses'} />
              </div>
              <div className="cols">
                <ThisMonth h={health} />
                <Card title="Ingresos y gastos" sub="Arriba lo que ingresas; abajo lo que gastas con tarjeta, retiradas y recibos">
                  <Diverge height={220} label="Ingresos y gastos por mes" data={flows}
                    tip={(d) => <><small>{d.label}</small><b>{eurS(d.up - d.down)} de ahorro</b><small>ingresos {eur(d.up)} · gastos {eur(d.down)}</small>{d.inv ? <small>{d.inv > 0 ? 'invertido' : 'vendido'} {eur(Math.abs(d.inv))}</small> : null}</>} />
                </Card>
              </div>
            </>
          );
        })()}
        </>
      )}

      {tab === 'gastos' && (cash.moves?.some(isSpend)
        ? <Spending moves={cash.moves} cats={cats} onCats={onCats} budgets={budgets} onBudgets={onBudgets} fail={fail} />
        : <div className="card"><Empty>Tu CSV no tiene pagos con tarjeta ni transferencias salientes.</Empty></div>)}

      {tab === 'movimientos' && cash.moves && <Statement moves={cash.moves} labels={labels} year={year} years={years} setYear={setYear} />}

      {tab === 'patrimonio' && <Wealth portfolioValue={portfolioValue} cash={cash} hist={hist} fail={fail} />}

      {tab === 'analisis' && (
        <>
        <div className="sect-h">
          <h2>Movimientos {per}</h2>
          <Seg label="Año" options={[['all', 'Todo'], ...years.map((y) => [y, y])]} value={year} onChange={setYear} />
        </div>

        <div className="kpis-row">
          {kpis.map(({ key, bars, ...k }) => <Kpi key={key} {...k} spark={bars.length > 1 && <Spark bars={bars.map((v) => Math.max(0, v))} />} />)}
        </div>

        <div className="cols">
          <Card title="Por concepto" sub="A la derecha lo que entra en la cuenta; a la izquierda lo que sale">
            <div className="flow">
              {flows.map((f) => <FlowRow key={f.k} label={labels[f.k] ?? f.k} v={f.v} max={max} />)}
              <FlowRow label="Variación del saldo" v={net} max={max} total />
            </div>
          </Card>
          <Card title="Variación mes a mes" sub="Lo que sube o baja el saldo cada mes">
            <Columns signed height={220} label="Variación mensual del efectivo"
              data={months.map(([m, g]) => ({ key: m, label: month(m), v: sumOf(g) }))}
              tip={(d) => <><small>{d.label}</small><b>{eurS(d.v)}</b></>} />
          </Card>
        </div>
          {cash.moves && <Heatmap moves={cash.moves} cats={cats} months={months.map(([m]) => m).slice(-12)} />}

        <section className="card table-card">
          <header className="card-h"><div><h2>Mes a mes</h2><p>{months.length} meses · cada concepto por separado</p></div></header>
          <div className="pad-x">
            <button type="button" className="fold" aria-expanded={table} onClick={() => setTable((v) => !v)}>
              {table ? 'Ocultar la tabla' : 'Ver la tabla mes a mes'}
            </button>
          </div>
          {table && (
            <table className="tbl">
              <thead>
                <tr><th className="l">Mes</th><th>Ingresos</th><th className="hide-s">Retiradas</th><th>Tarjeta</th><th>Inversión</th>
                  <th className="hide-s">Dividendos</th><th className="hide-m">Intereses y premios</th><th className="hide-s">Variación</th></tr>
              </thead>
              <tbody>
                {[...months].reverse().map(([m, g]) => {
                  const c = (k) => (g[k] ? eurS(g[k]) : <span className="mu">—</span>);
                  const extra = (g.interest ?? 0) + (g.reward ?? 0);
                  return (
                    <tr key={m} className="static">
                      <td className="l"><b>{month(m)}</b></td><td>{c('deposit')}</td><td className="hide-s">{c('withdrawal')}</td><td>{c('card')}</td><td>{c('invest')}</td>
                      <td className="hide-s">{c('dividend')}</td><td className="hide-m">{extra ? eurS(extra) : <span className="mu">—</span>}</td>
                      <td className={`hide-s ${sign(sumOf(g))}`}>{eurS(sumOf(g))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
        </>
      )}

      <p className="note">
        El saldo se reconstruye sumando todos los movimientos del CSV. De los pagos con tarjeta se guarda el comercio y su
        categoría; de las transferencias, el nombre de la otra parte, nunca el IBAN ni la referencia. «Compras y ventas» es
        lo que sale en compras menos lo que entra en ventas; intereses y premios ya llevan descontada su retención.
      </p>
    </div>
  );
}
