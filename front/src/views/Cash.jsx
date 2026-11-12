import { useMemo, useState } from 'react';
import { Card, Empty, Seg } from '../components/ui.jsx';
import { Lines, Columns } from '../charts.jsx';
import { eur, eurS, sign, dateLong, month } from '../lib/format.js';

const ORDER = ['deposit', 'withdrawal', 'card', 'invest', 'dividend', 'interest', 'reward', 'tax', 'other'];

export default function Cash({ cash, labels, portfolioValue }) {
  const [year, setYear] = useState('all');
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
  const net = Object.values(totals).reduce((t, v) => t + v, 0);
  const income = (totals.interest ?? 0) + (totals.reward ?? 0);

  return (
    <div className="stack">
      <div className="dash">
        <div className="dash-main">
          <section className="hero">
            <span className="eyebrow">Efectivo en la cuenta</span>
            <div className="hero-v">{eur(cash.balance)}</div>
            <div className="hero-d">
              <span className="chg"><em>Reconstruido sumando todos los movimientos del CSV hasta el {dateLong(series.t.at(-1))}</em></span>
            </div>
          </section>
          <section className="chart-block">
            <Lines x={series.t} height={240} label="Saldo de efectivo" base={0}
              series={[{ key: 'v', values: series.v, cls: '', step: true, area: true }]}
              tip={(i) => <><small>{dateLong(series.t[i])}</small><b>{eur(series.v[i])}</b></>} />
          </section>
        </div>
        <aside className="dash-side">
          <Card title="Patrimonio">
            <div className="kvs">
              <div className="kv"><span>Cartera</span><b>{eur(portfolioValue)}</b></div>
              <div className="kv"><span>Efectivo</span><b>{eur(cash.balance)}</b></div>
              <div className="kv"><span>Total</span><b>{eur(portfolioValue + cash.balance)}</b></div>
            </div>
          </Card>
        </aside>
      </div>

      <div className="toolbar">
        <Seg label="Año" options={[['all', 'Todo'], ...years.map((y) => [y, y])]} value={year} onChange={setYear} />
      </div>

      <div className="cols">
        <Card title="Por concepto" sub={year === 'all' ? 'Todo el histórico' : `Año ${year}`}>
          <div className="kvs">
            {ORDER.filter((k) => totals[k]).map((k) => (
              <div className="kv" key={k}><span>{labels[k]}</span><b className={k === 'interest' || k === 'reward' || k === 'dividend' ? sign(totals[k]) : ''}>{eurS(totals[k])}</b></div>
            ))}
            <div className="kv"><span>Variación del saldo</span><b>{eurS(net)}</b></div>
          </div>
          <p className="note">Intereses, saveback y bonus te han dado {eur(income)} {year === 'all' ? 'en total' : `en ${year}`}, ya descontada su retención.</p>
        </Card>
        <Card title="Variación mensual del saldo">
          <Columns signed height={230} label="Variación mensual del efectivo"
            data={months.map(([m, g]) => ({ key: m, label: month(m), v: Object.values(g).reduce((t, v) => t + v, 0) }))}
            tip={(d) => <><small>{d.label}</small><b>{eurS(d.v)}</b></>} />
        </Card>
      </div>

      <div className="card table-card">
        <header className="card-h"><div><h2>Mes a mes</h2></div></header>
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
                  <td className="hide-s">{eurS(Object.values(g).reduce((t, v) => t + v, 0))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="note">
        De los pagos con tarjeta y las transferencias solo se guarda la fecha y el importe, nunca el comercio ni el concepto.
        «Inversión» es lo que sale en compras menos lo que entra en ventas.
      </p>
    </div>
  );
}
