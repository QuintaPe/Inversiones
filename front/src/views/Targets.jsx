import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Asset, Empty } from '../components/ui.jsx';
import { rebalance } from '../lib/calc.js';
import { eur, pct, qty, sign, isMasked, MASK } from '../lib/format.js';

const n = (v) => parseFloat(String(v).replace(',', '.')) || 0;
const show = (w) => (w ? String(+w.toFixed(2)).replace('.', ',') : '');

/** Cartera objetivo: peso deseado por posición y qué comprar o vender para acercarte. */
export default function Targets({ a, targets, patch, fail, onOpen }) {
  const rows = a.priced;
  const [draft, setDraft] = useState({}); // lo que hay escrito en cada campo
  const [extra, setExtra] = useState('');
  useEffect(() => setDraft(Object.fromEntries(rows.map((x) => [x.p.isin, show(targets[x.p.isin])]))), [targets, rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const weights = Object.fromEntries(rows.map((x) => [x.p.isin, n(draft[x.p.isin])]));
  const total = Object.values(weights).reduce((t, w) => t + w, 0);
  const plan = useMemo(() => rebalance(rows.map((x) => ({ isin: x.p.isin, v: x.v, price: x.p.price })), weights, n(extra)), [rows, draft, extra]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (next) => {
    try { patch(await api.setTargets(next)); } catch (e) { fail(e); }
  };
  const commit = (isin) => {
    if (isMasked()) return;
    const w = n(draft[isin]);
    if (w !== (targets[isin] ?? 0)) save({ [isin]: w || null });
  };
  const fill = (f) => save(Object.fromEntries(rows.map((x) => [x.p.isin, +f(x).toFixed(2)])));

  if (!rows.length) return <div className="card"><Empty>Hacen falta posiciones con precio para definir una cartera objetivo.</Empty></div>;
  const ok = Math.abs(total - 100) < 0.05;

  const max = Math.max(...rows.map((x) => Math.max(x.w ?? 0, weights[x.p.isin] || 0)), 1);
  const buys = Object.values(plan.rows).filter((r) => r.delta >= 0.5).reduce((t, r) => t + r.delta, 0);
  const sells = Object.values(plan.rows).filter((r) => r.delta <= -0.5).reduce((t, r) => t - r.delta, 0);

  return (
    <div className="stack">
      <div className="tgt-head">
        <div className="kpis-row">
          <div className="kpi">
            <span className="kpi-l">Suma de objetivos</span>
            <b className={`kpi-v ${ok ? '' : 'loss'}`}>{pct(total)}</b>
            <small className="kpi-s">{ok ? 'lista para calcular' : `faltan ${pct(Math.max(0, 100 - total))} por repartir`}</small>
          </div>
          <div className="kpi">
            <span className="kpi-l">A comprar</span>
            <b className="kpi-v">{eur(buys)}</b>
            <small className="kpi-s">{n(extra) > 0 ? 'con la aportación nueva' : 'para clavar los objetivos'}</small>
          </div>
          <div className="kpi">
            <span className="kpi-l">A vender</span>
            <b className="kpi-v">{eur(sells)}</b>
            <small className="kpi-s">{n(extra) > 0 ? 'nada: solo se compra' : 'lo que pesa de más'}</small>
          </div>
          <label className="kpi tgt-extra">
            <span className="kpi-l">Aportación nueva (€)</span>
            <input inputMode="decimal" placeholder="0" readOnly={isMasked()} value={isMasked() ? (extra ? MASK : '') : extra} onChange={(ev) => setExtra(ev.target.value)} />
            <small className="kpi-s">opcional: solo se proponen compras</small>
          </label>
        </div>
        <div className="toolbar">
          <button type="button" className="btn" onClick={() => fill((x) => x.w)}>Usar los pesos actuales</button>
          <button type="button" className="btn" onClick={() => fill(() => 100 / rows.length)}>Repartir a partes iguales</button>
        </div>
      </div>

      <section className="card">
        <header className="card-h"><div><h2>Peso actual frente a objetivo</h2><p>La barra es tu peso de hoy; la marca, el objetivo</p></div></header>
        <ul className="tgt-l">
          {rows.map((x) => {
            const r = plan.rows[x.p.isin], t = weights[x.p.isin] || 0;
            const act = Math.abs(r.delta) >= 0.5;
            return (
              <li key={x.p.isin}>
                <button type="button" className="plain tgt-a" onClick={() => onOpen(x.p.isin)}><Asset p={x.p} size="sm">{pct(x.w)} hoy · {eur(x.v)}</Asset></button>
                <span className="tgt-bar" aria-hidden="true">
                  <i style={{ width: `${((x.w ?? 0) / max) * 100}%` }} />
                  {t > 0 && <em style={{ left: `${(t / max) * 100}%` }} />}
                </span>
                <label className="tgt-in">
                  <input className="tgt" inputMode="decimal" placeholder="0" aria-label={`Peso objetivo de ${x.p.name} en porcentaje`}
                    readOnly={isMasked()} value={isMasked() ? (draft[x.p.isin] ? MASK : '') : draft[x.p.isin] ?? ''} onChange={(ev) => setDraft((d) => ({ ...d, [x.p.isin]: ev.target.value }))}
                    onBlur={() => commit(x.p.isin)} onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()} />
                  <span>%</span>
                </label>
                <span className="tgt-do">
                  {act ? (
                    <>
                      <b className={sign(r.delta)}>{r.delta > 0 ? 'Comprar' : 'Vender'} {eur(Math.abs(r.delta))}</b>
                      {x.p.price > 0 && <small>≈ {qty(+(Math.abs(r.delta) / x.p.price).toFixed(3))} uds.</small>}
                    </>
                  ) : <span className="mu">{t ? 'en su objetivo' : '—'}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      <p className="note">
        {!ok && 'Los objetivos deben sumar 100 % para que el ajuste tenga sentido. '}
        {n(extra) > 0
          ? 'Con una aportación nueva solo se proponen compras: el dinero se reparte entre lo que está por debajo de su objetivo, sin vender nada.'
          : 'Sin aportación, el ajuste propone vender lo que pesa de más y comprar lo que pesa de menos hasta clavar los objetivos.'}
        {' '}Es una ayuda de cálculo, no una recomendación: vender tiene comisiones e impuestos, que puedes estimar en la ficha de cada valor.
      </p>
    </div>
  );
}
