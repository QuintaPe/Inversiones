import { useMemo, useState } from 'react';
import { Card, Empty, Icon, Seg } from '../components/ui.jsx';
import { Kpi, Spark } from '../components/Kpi.jsx';
import { Lines, Columns } from '../charts.jsx';
import { eur, eurS, pct, sign, dateLong, month } from '../lib/format.js';

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

export default function Cash({ cash, labels, portfolioValue }) {
  const [year, setYear] = useState('all');
  const [table, setTable] = useState(false);
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
          pagos con tarjeta y las transferencias solo se guarda la fecha y el importe, nunca el comercio ni el concepto.
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
      <section className="hero">
        <span className="eyebrow">Efectivo en la cuenta</span>
        <div className="hero-v">{eur(cash.balance)}</div>
        <div className="hero-d">
          {total > 0 && (
            <span className="chg"><em>{pct((cash.balance / total) * 100)} de tu patrimonio · total con la cartera {eur(total)}</em></span>
          )}
          <span className="chg"><em>Movimientos del CSV hasta el {dateLong(series.t.at(-1))}</em></span>
        </div>
        {cash.roundUps && (
          <p className="callout">
            <Icon name="alert" size={15} />
            <span>
              {eur(cash.ledger)} en movimientos − {eur(cash.roundUps.amount)} de redondeos de {cash.roundUps.n === 1 ? '1 pago' : `${cash.roundUps.n} pagos`} con
              tarjeta, reservados para la próxima inversión semanal.
            </span>
          </p>
        )}
      </section>

      <section className="chart-block">
        <Lines x={series.t} height={220} label="Saldo de efectivo" base={0}
          series={[{ key: 'v', values: series.v, cls: '', step: true, area: true }]}
          tip={(i) => <><small>{dateLong(series.t[i])}</small><b>{eur(series.v[i])}</b></>} />
      </section>

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

      <p className="note">
        El saldo se reconstruye sumando todos los movimientos del CSV. De los pagos con tarjeta y las transferencias solo se
        guarda la fecha y el importe, nunca el comercio ni el concepto. «Compras y ventas» es lo que sale en compras menos
        lo que entra en ventas; intereses y premios ya llevan descontada su retención.
      </p>
    </div>
  );
}
