// Proyección: a dónde llega la cartera si sigues aportando, en tres escenarios, y cuándo alcanzas una meta.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Card } from '../components/ui.jsx';
import { Lines } from '../charts.jsx';
import { useStored } from '../hooks.js';
import { project, monthsToGoal, monthlyContribution } from '../../../shared/calc.js';
import { planProgress } from '../../../shared/plan.js';
import { eur, eurS, compact, date, isMasked } from '../lib/format.js';

const SPREAD = 3; // puntos de rentabilidad anual arriba y abajo del escenario central
const num = (s, min, max) => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };
const when = (m) => {
  const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + m);
  return d.toLocaleDateString('es-ES', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
const span = (m) => (m < 12 ? `${m} ${m === 1 ? 'mes' : 'meses'}` : `${Math.floor(m / 12)} ${Math.floor(m / 12) === 1 ? 'año' : 'años'}${m % 12 ? ` y ${m % 12} ${m % 12 === 1 ? 'mes' : 'meses'}` : ''}`);

const text = (n) => (n == null ? '' : String(n).replace('.', ','));
const todayIso = () => new Date().toISOString().slice(0, 10);

/**
 * @param plan    plan guardado en la cuenta ({ monthly, rate, years, goal, start, since }) o undefined
 * @param onPlan  (plan) => void para guardarlo; null si aquí no se guarda (con un filtro de tipo de activo)
 */
export default function Projection({ value, all, plan, onPlan }) {
  const usual = useMemo(() => Math.max(0, Math.round(monthlyContribution(all) / 10) * 10), [all]);
  // Lo que escribes se guarda en tu cuenta (y en este navegador, por si no hay conexión); la
  // aportación vacía usa tu media del último año.
  const [local, setLocal] = useStored('projection', { monthly: '', rate: '5', years: '15', goal: '' });
  // Lo guardado en la cuenta manda sobre lo de este navegador.
  const [f, setFields] = useState(() => (plan
    ? { monthly: text(plan.monthly), rate: text(plan.rate ?? 5), years: text(plan.years ?? 15), goal: text(plan.goal) }
    : local));
  const monthly = num(f.monthly, 0, 1e6) ?? usual, rate = num(f.rate, -20, 30) ?? 5, years = num(f.years, 1, 50) ?? 15;
  const goal = num(f.goal, 0, 1e10);
  // Guardado en la cuenta: un momento después de dejar de escribir (y al salir, lo que quedara pendiente).
  const pending = useRef(null); // { timer, plan }
  const send = useRef(onPlan);
  useEffect(() => { send.current = onPlan; });
  const flush = () => {
    if (!pending.current) return;
    clearTimeout(pending.current.timer);
    send.current?.(pending.current.plan);
    pending.current = null;
  };
  // Lo pendiente se envía al salir de un campo, al desmontar y, si da tiempo, al cerrar la página.
  useEffect(() => {
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []); // flush solo usa refs
  const save = (fields) => {
    if (!onPlan) return;
    clearTimeout(pending.current?.timer);
    const next = {
      monthly: num(fields.monthly, 0, 1e6), rate: num(fields.rate, -20, 30) ?? 5, years: num(fields.years, 1, 50) ?? 15, goal: num(fields.goal, 0, 1e10),
      start: plan?.start ?? null, since: plan?.since ?? null,
    };
    pending.current = { plan: next, timer: setTimeout(flush, 500) };
  };
  const setF = (next) => { setFields(next); setLocal(next); save(next); };
  const set = (k) => (ev) => setF({ ...f, [k]: ev.target.value });
  // Plan frente a realidad: desde el día en que lo fijas, con la aportación y la rentabilidad del plan.
  const fix = (on) => { clearTimeout(pending.current?.timer); pending.current = null; onPlan({ monthly: num(f.monthly, 0, 1e6) ?? usual, rate, years, goal, ...(on ? { start: +value.toFixed(2), since: todayIso() } : { start: null, since: null }) }); };
  const progress = onPlan && plan?.since ? planProgress({ ...plan, monthly: plan.monthly ?? usual }, value) : null;

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
      <div className="form proj-f" onBlur={flush}>
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

      <Lines x={x} height={240} base={0} scale={compact} label="Proyección a futuro en tres escenarios"
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
      {onPlan && !isMasked() && (
        <div className="proj-t">
          {progress ? (
            <>
              <p role="status">
                {progress.months < 1
                  ? <>Plan fijado el <b>{date(plan.since)}</b> con {eur(plan.start)}. Dentro de un mes verás aquí si vas por delante o por detrás.</>
                  : <>Según tu plan del <b>{date(plan.since)}</b>, hoy esperabas tener <b>{eur(progress.expected)}</b> y tienes <b>{eur(value)}</b>:
                    vas <b className={progress.diff >= 0 ? 'gain' : 'loss'}>{eurS(progress.diff)}</b> {progress.diff >= 0 ? 'por delante' : 'por detrás'}.</>}
              </p>
              <span className="proj-tb">
                <button type="button" className="btn soft" onClick={() => fix(true)}>Empezar de nuevo hoy</button>
                <button type="button" className="btn soft" onClick={() => fix(false)}>Dejar de medir</button>
              </span>
            </>
          ) : (
            <>
              <p>Fija este plan hoy y la app te irá diciendo si vas por delante o por detrás de él.</p>
              <span className="proj-tb"><button type="button" className="btn soft" onClick={() => fix(true)}>Seguir este plan desde hoy</button></span>
            </>
          )}
        </div>
      )}
      <p className="note">
        Cuenta con interés compuesto, sin inflación ni impuestos, partiendo del valor actual de la cartera. Ninguna rentabilidad
        está garantizada: los escenarios de ±{SPREAD} puntos solo enseñan cuánto cambia el resultado con ella.
      </p>
    </Card>
  );
}
