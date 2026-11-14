// Proyección: a dónde llega la cartera si sigues aportando, en tres escenarios, y cuándo alcanzas una meta.
import { useMemo } from 'react';
import { Card } from '../components/ui.jsx';
import { Lines } from '../charts.jsx';
import { useStored } from '../hooks.js';
import { project, monthsToGoal, monthlyContribution } from '../lib/calc.js';
import { eur, compact, isMasked } from '../lib/format.js';

const SPREAD = 3; // puntos de rentabilidad anual arriba y abajo del escenario central
const num = (s, min, max) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const when = (m) => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const span = (m) => (m < 12 ? `${m} ${m === 1 ? 'mes' : 'meses'}` : `${Math.floor(m / 12)} ${Math.floor(m / 12) === 1 ? 'año' : 'años'}${m % 12 ? ` y ${m % 12} ${m % 12 === 1 ? 'mes' : 'meses'}` : ''}`);

export default function Projection({ value, all }) {
  const usual = useMemo(() => Math.max(0, Math.round(monthlyContribution(all) / 10) * 10), [all]);
  // Lo que escribes se queda en este navegador; la aportación vacía usa tu media del último año.
  const [f, setF] = useStored('projection', { monthly: '', rate: '5', years: '15', goal: '' });
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  const monthly = num(f.monthly, 0, 1e6) ?? usual, rate = num(f.rate, -20, 30) ?? 5, years = num(f.years, 1, 50) ?? 15;
  const goal = num(f.goal, 0, 1e10);

  const { x, base, low, high, put } = useMemo(() => {
    const run = (r) => project({ start: value, monthly, rate: r, years });
    const b = run(rate), now = new Date();
    const t0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
    return {
      x: b.map((p) => { const d = new Date(t0); d.setUTCMonth(d.getUTCMonth() + p.m); return d.getTime(); }),
      base: b, low: run(rate - SPREAD), high: run(rate + SPREAD), put: b.map((p) => p.put),
    };
  }, [value, monthly, rate, years]);
  const end = base.at(-1);
  const reach = goal ? monthsToGoal(base, goal) : null;
  const reachLow = goal ? monthsToGoal(low, goal) : null, reachHigh = goal ? monthsToGoal(high, goal) : null;

  return (
    <Card title="Proyección" sub="Si sigues aportando: a dónde llegas y cuándo alcanzas tu meta">
      <div className="form proj-f">
        <label><span>Aportación al mes (€)</span><input inputMode="decimal" value={f.monthly} onChange={set('monthly')} placeholder={isMasked() ? '' : String(usual)} /></label>
        <label><span>Rentabilidad anual (%)</span><input inputMode="decimal" value={f.rate} onChange={set('rate')} placeholder="5" /></label>
        <label><span>Años</span><input inputMode="numeric" value={f.years} onChange={set('years')} placeholder="15" /></label>
        <label><span>Meta (€, opcional)</span><input inputMode="decimal" value={f.goal} onChange={set('goal')} placeholder="p. ej. 250000" /></label>
      </div>

      <div className="perf proj-s">
        <div><span className="stat-l">En {span(Math.round(years * 12))}</span><b className="stat-v">{eur(end.v)}</b></div>
        <div><span className="stat-l">Habrás aportado</span><b className="stat-v">{eur(end.put)}</b></div>
        <div><span className="stat-l">Lo pone el mercado</span><b className={`stat-v ${end.v >= end.put ? 'gain' : 'loss'}`}>{eur(end.v - end.put)}</b></div>
      </div>

      <Lines x={x} height={240} base={0} label="Proyección del valor de la cartera en tres escenarios"
        series={[
          { key: 'base', values: base.map((p) => p.v), cls: 'up', area: true },
          { key: 'high', values: high.map((p) => p.v), cls: 'b1' },
          { key: 'low', values: low.map((p) => p.v), cls: 'b2' },
          { key: 'put', values: put, cls: 'muted' },
          ...(goal ? [{ key: 'goal', values: x.map(() => goal), cls: 'muted goal' }] : []),
        ]}
        tip={(i) => (
          <>
            <small>{when(base[i].m)}</small><b>{eur(base[i].v)}</b>
            <small>entre {compact(low[i].v)} y {compact(high[i].v)} · aportado {eur(put[i])}</small>
          </>
        )} />
      <ul className="legend legend-f">
        <li><i className="sw up" />Al {rate.toLocaleString('es-ES')} %</li>
        <li><i className="sw b1" />Al {(rate + SPREAD).toLocaleString('es-ES')} %</li>
        <li><i className="sw b2" />Al {(rate - SPREAD).toLocaleString('es-ES')} %</li>
        <li><i className="sw muted" />Aportado</li>
      </ul>

      {goal > 0 && (
        <p className="proj-g" role="status">
          {reach === 0 ? <>Ya has alcanzado tu meta de <b>{eur(goal)}</b>.</>
            : reach != null ? <>Alcanzas <b>{eur(goal)}</b> en <b>{when(reach)}</b>, dentro de {span(reach)}
              {reachHigh != null && reachLow != null && reachHigh !== reachLow && <> (entre {span(reachHigh)} y {span(reachLow)} según el escenario)</>}.</>
            : <>Con estas cifras no llegas a <b>{eur(goal)}</b> en {span(Math.round(years * 12))}: te quedarías en {eur(end.v)}.</>}
        </p>
      )}
      <p className="note">
        Cuenta con interés compuesto, sin inflación ni impuestos, partiendo del valor actual de la cartera. Ninguna rentabilidad
        está garantizada: los escenarios de ±{SPREAD} puntos solo enseñan cuánto cambia el resultado con ella.
      </p>
    </Card>
  );
}
