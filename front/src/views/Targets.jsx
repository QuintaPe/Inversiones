import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Asset, Empty } from '../components/ui.jsx';
import { rebalance } from '../lib/calc.js';
import { eur, eurS, pct, qty, sign, isMasked, MASK } from '../lib/format.js';

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

  return (
    <div className="stack">
      <div className="card tgt-top">
        <label><span>Aportación nueva (€)</span>
          <input inputMode="decimal" placeholder="0" readOnly={isMasked()} value={isMasked() ? (extra ? MASK : '') : extra} onChange={(ev) => setExtra(ev.target.value)} /></label>
        <button type="button" className="btn" onClick={() => fill((x) => x.w)}>Usar los pesos actuales</button>
        <button type="button" className="btn" onClick={() => fill(() => 100 / rows.length)}>Repartir a partes iguales</button>
        <div className="tgt-sum">
          <span className="stat-l">Suma de objetivos</span>
          <b className={ok ? '' : 'loss'}>{pct(total)}</b>
        </div>
      </div>

      <div className="card table-card">
        <table className="tbl">
          <thead>
            <tr><th className="l">Activo</th><th className="hide-s">Peso actual</th><th>Objetivo %</th><th className="hide-s">Desviación</th>
              <th>{n(extra) > 0 ? 'Comprar' : 'Ajuste'}</th><th className="hide-m">Unidades aprox.</th></tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const r = plan.rows[x.p.isin];
              return (
                <tr key={x.p.isin} className="static">
                  <td className="l"><button type="button" className="plain" onClick={() => onOpen(x.p.isin)}><Asset p={x.p}>{eur(x.v)}</Asset></button></td>
                  <td className="hide-s">{pct(x.w)}</td>
                  <td>
                    <input className="tgt" inputMode="decimal" placeholder="0" aria-label={`Peso objetivo de ${x.p.name} en porcentaje`}
                      readOnly={isMasked()} value={isMasked() ? (draft[x.p.isin] ? MASK : '') : draft[x.p.isin] ?? ''} onChange={(ev) => setDraft((d) => ({ ...d, [x.p.isin]: ev.target.value }))}
                      onBlur={() => commit(x.p.isin)} onKeyDown={(ev) => ev.key === 'Enter' && ev.currentTarget.blur()} />
                  </td>
                  <td className={`hide-s ${ok && r.w ? sign(x.w - r.w) : ''}`}>{r.w ? `${x.w - r.w >= 0 ? '+' : '−'}${pct(Math.abs(x.w - r.w))}` : <span className="mu">—</span>}</td>
                  <td className={Math.abs(r.delta) >= 0.5 ? sign(r.delta) : ''}>{Math.abs(r.delta) >= 0.5 ? eurS(r.delta) : <span className="mu">—</span>}</td>
                  <td className="hide-m">{Math.abs(r.delta) >= 0.5 && x.p.price > 0 ? qty(+(Math.abs(r.delta) / x.p.price).toFixed(3)) : <span className="mu">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td className="l">Total</td><td className="hide-s">100,00 %</td><td className={ok ? '' : 'loss'}>{pct(total)}</td><td className="hide-s" />
              <td>{eurS(plan.net)}</td><td className="hide-m" /></tr>
          </tfoot>
        </table>
      </div>
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
