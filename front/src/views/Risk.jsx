// Posiciones → Análisis: riesgo y diversificación con el último año de cierres (shared/risk.js,
// calculado en el servidor): cuánto se mueve la cartera, quién aporta ese riesgo y qué valores
// se mueven juntos.
import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { Card, Empty } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { RankBars } from '../charts.jsx';
import { pct, num } from '../lib/format.js';

const MAX_GRID = 10; // la tabla de correlaciones, con los valores que más pesan
const short = (name) => name.replace(/\b(iShares|Vanguard|Core|UCITS|ETF|\(Acc\)|\(Dist\)|USD|EUR)\b/g, '').replace(/\s+/g, ' ').trim().slice(0, 10) || name.slice(0, 10);
const level = (r) => (r >= 0.8 ? 'muy parecidos' : r >= 0.5 ? 'parecidos' : r >= 0.2 ? 'algo parecidos' : r > -0.2 ? 'independientes' : 'se compensan');

export default function Risk({ a, onOpen, fail }) {
  const [risk, setRisk] = useState(undefined); // undefined = cargando; null = sin datos
  useEffect(() => {
    let alive = true;
    api.getRisk().then((r) => alive && setRisk(r.risk)).catch((e) => { if (alive) { setRisk(null); fail(e); } });
    return () => { alive = false; };
  }, [fail, a.o.length]);
  if (risk === undefined) return <div className="sk" style={{ height: 320 }} />;
  if (!risk) {
    return (
      <div className="card">
        <Empty>
          Hace falta al menos tres meses de cotizaciones de dos de tus valores para medir el riesgo. El histórico se
          descarga solo la primera vez que abres el Resumen con las cotizaciones en vivo activadas.
        </Empty>
      </div>
    );
  }
  const pos = Object.fromEntries(a.o.map((x) => [x.p.isin, x.p]));
  const name = (k) => pos[k]?.name ?? k;
  const byShare = [...risk.assets].sort((x, y) => y.share - x.share);
  const top = byShare[0];
  const max = Math.max(...byShare.map((x) => x.share), 1);
  const less = risk.weighted > 0 ? (1 - risk.vol / risk.weighted) * 100 : 0;
  // Tabla de correlaciones: los que más pesan, en el orden del informe.
  const order = risk.assets.map((x, i) => ({ ...x, i })).sort((x, y) => y.w - x.w).slice(0, MAX_GRID);

  return (
    <div className="stack">
      <div className="kpis-row kpis-fit" style={{ '--n': 3 }}>
        <Kpi label="Volatilidad de la cartera" value={`${pct(risk.vol)} anual`} sub={`cuánto oscila, con ${risk.weeks} semanas de datos`} />
        <Kpi label="Lo que te quita diversificar" value={less >= 0.05 ? `−${pct(less)}` : pct(0)} tone={less >= 5 ? 'gain' : ''}
          sub={`de riesgo frente a la media de tus valores (${pct(risk.weighted)})`} />
        <Kpi label="Posiciones efectivas" value={num(risk.effN)} sub={`de ${risk.assets.length}: como si repartieras a partes iguales entre ${Math.max(1, Math.round(risk.effN))}`} />
      </div>

      <div className="cols">
        <Card title="Quién aporta el riesgo" sub={top ? `${name(top.key)} pone el ${pct(top.share)} del riesgo con el ${pct(top.w)} del dinero` : ''}>
          <RankBars rows={byShare.map((x) => ({
            key: x.key, label: name(x.key), w: (Math.max(0, x.share) / max) * 100, right: pct(x.share),
            sub: `pesa ${pct(x.w)} · volatilidad ${pct(x.vol)}`, other: x.share <= x.w, onClick: () => onOpen(x.key),
          }))} />
          <p className="note">
            La barra es la parte del vaivén de la cartera que viene de cada valor. En color, los que aportan más riesgo que
            dinero; un valor que se mueve al revés que el resto puede restar.
          </p>
        </Card>

        <Card title="Cuánto se parecen" sub="Correlación entre tus valores: de −1 (se compensan) a 1 (se mueven a la vez)">
          <div className="corr-w">
            <table className="corr">
              <thead>
                <tr><th scope="col"><span className="sr-only">Valor</span></th>{order.map((x) => <th key={x.key} scope="col" title={name(x.key)}>{short(name(x.key))}</th>)}</tr>
              </thead>
              <tbody>
                {order.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" title={name(r.key)}>{short(name(r.key))}</th>
                    {order.map((c) => {
                      const v = risk.corr[r.i][c.i];
                      return (
                        <td key={c.key} className={r.key === c.key ? 'self' : ''} style={v == null || r.key === c.key ? undefined : { '--r': Math.abs(v), '--c': v >= 0 ? 'var(--acc)' : 'var(--s2)' }}
                          title={v == null ? 'Sin semanas suficientes en común' : `${name(r.key)} y ${name(c.key)}: ${num(v)}`}>
                          {r.key === c.key ? '' : v == null ? '·' : v.toLocaleString('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {risk.pairs.length > 0 && (
            <>
              <h3 className="kv-h">Los que más se mueven juntos</h3>
              <ul className="vals">
                {risk.pairs.slice(0, 3).map((p) => (
                  <li key={`${p.a}|${p.b}`}><span><b>{name(p.a)}</b> y <b>{name(p.b)}</b></span><em className="mu">{level(p.r)}</em><b>{num(p.r)}</b></li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </div>
      <p className="note">
        Con las rentabilidades semanales en euros del último año. Lo que pasó no garantiza lo que pasará: sirve para ver
        concentraciones, no para predecir.
        {risk.skipped.length > 0 && ` Sin histórico suficiente y fuera del cálculo: ${risk.skipped.map(name).join(', ')}.`}
        {' '}Los valores sin cotización pública tampoco entran.
      </p>
    </div>
  );
}
