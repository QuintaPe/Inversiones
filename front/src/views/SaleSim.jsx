// Simulador de ventas de cartera (Fiscalidad → Simular): qué pasa en la declaración de este año
// si vendes hoy varias posiciones a la vez.
import { useMemo, useState } from 'react';
import { Asset, Card, Empty, Icon } from '../components/ui.jsx';
import { simulateSale } from '../../../shared/calc.js';
import { simulateSales } from '../../../shared/sales.js';
import { eur, eurS, qty, sign, date, isMasked } from '../lib/format.js';

const txt = (n) => String(+n.toFixed(6)).replace('.', ',');
// Resultado de la declaración: en negativo, las retenciones superan la cuota y te devuelven.
const due = (n) => (n < -0.005 ? `te devuelven ${eur(-n)}` : `a pagar ${eur(Math.max(0, n))}`);
const read = (s) => parseFloat(String(s).replace(',', '.')) || 0;

export default function SaleSim({ a, income, onOpen }) {
  // Posiciones que se pueden simular, con lo que aflorarían enteras al precio actual.
  const list = useMemo(() => a.o.filter((x) => x.has && x.p.sh > 0 && x.p.lots?.length)
    .map((x) => ({ x, gain: simulateSale(x.p.lots, x.p.sh, x.v / x.p.sh).gain }))
    .sort((p, q) => p.gain - q.gain), [a.o]);
  const [picks, setPicks] = useState({}); // { ISIN: unidades (texto) }
  const chosen = useMemo(() => Object.entries(picks).map(([isin, sh]) => ({ isin, sh: read(sh) })), [picks]);
  const sim = useMemo(() => simulateSales(a.o, chosen, a.sl, a.dv, income), [a.o, a.sl, a.dv, income, chosen]);
  const toggle = (x) => setPicks((p) => {
    const { [x.p.isin]: was, ...rest } = p;
    return was != null ? rest : { ...p, [x.p.isin]: txt(x.p.sh) };
  });
  const pickAll = (rows) => setPicks(Object.fromEntries(rows.map(({ x }) => [x.p.isin, txt(x.p.sh)])));
  const losers = list.filter((r) => r.gain < -0.005);

  if (isMasked()) return <div className="card"><Empty>Muestra los importes para simular ventas.</Empty></div>;
  if (!list.length) return <div className="card"><Empty>No hay posiciones abiertas con precio que simular.</Empty></div>;
  const wash = sim.rows.filter((r) => r.wash.length);

  return (
    <div className="cols ssim no-print">
      <Card title="Qué venderías hoy" sub="Marca las posiciones y ajusta las unidades; se venden por FIFO al precio actual"
        right={(
          <span className="ssim-q">
            {losers.length > 0 && <button type="button" className="btn soft" onClick={() => pickAll(losers)}>Las que pierden</button>}
            {chosen.length > 0 && <button type="button" className="btn soft" onClick={() => setPicks({})}>Limpiar</button>}
          </span>
        )}>
        <ul className="ssim-l">
          {list.map(({ x, gain }) => {
            const on = picks[x.p.isin] != null;
            const row = sim.rows.find((r) => r.x.p.isin === x.p.isin);
            return (
              <li key={x.p.isin} className={on ? 'on' : ''}>
                <label className="ssim-c">
                  <input type="checkbox" checked={on} onChange={() => toggle(x)} aria-label={`Vender ${x.p.name}`} />
                  <Asset p={x.p} size="sm">{qty(x.p.sh)} uds. · entera aflora <span className={sign(gain)}>{eurS(gain)}</span></Asset>
                </label>
                {on && (
                  <span className="ssim-u">
                    <input type="text" inputMode="decimal" value={picks[x.p.isin]} aria-label={`Unidades de ${x.p.name} a vender`}
                      onChange={(ev) => setPicks((p) => ({ ...p, [x.p.isin]: ev.target.value }))} />
                    <small className={row ? sign(row.gain) : 'mu'}>{row ? eurS(row.gain) : 'sin unidades'}</small>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title={`En tu declaración de ${sim.year}`} sub="El efecto conjunto de estas ventas, sumado a lo que ya llevas este año">
        {sim.rows.length ? (
          <>
            <span className="eyebrow">Te quedarías con</span>
            <div className="sim-v">{eur(sim.keep)}</div>
            <p className="sim-s">
              <span className={sign(sim.gain)}>{eurS(sim.gain)}</span> de {sim.gain >= 0 ? 'ganancia' : 'pérdida'} ·{' '}
              {sim.tax >= 0.005 ? `${eur(sim.tax)} más de impuesto` : sim.tax <= -0.005 ? `${eur(-sim.tax)} menos de impuesto` : 'sin cambio en el impuesto'}
            </p>
            <div className="calc">
              <div><span>Cobrarías ({sim.rows.length} {sim.rows.length === 1 ? 'venta' : 'ventas'}, 1 € de comisión cada una)</span><b>{eur(sim.proceeds)}</b></div>
              <div><span>− Coste de adquisición (FIFO)</span><b>−{eur(sim.cost)}</b></div>
              <div className="t"><span>= Resultado que afloras</span><b className={sign(sim.gain)}>{eurS(sim.gain)}</b></div>
              <div><span>Tu declaración sin estas ventas</span><b>{due(sim.before)}</b></div>
              <div><span>Con ellas</span><b>{due(sim.after)}</b></div>
              <div className="t"><span>{sim.tax >= 0 ? 'Impuesto que añaden' : 'Impuesto que ahorran'}</span><b className={sim.tax < -0.005 ? 'gain' : ''}>{eur(Math.abs(sim.tax))}</b></div>
              {sim.carried >= 0.005 && <div><span>Pérdida que queda pendiente para los cuatro años siguientes</span><b>{eur(sim.carried)}</b></div>}
            </div>
            {wash.length > 0 && (
              <p className="callout">
                <Icon name="alert" size={15} />
                <span>
                  Regla de los dos meses: has comprado {wash.map((r) => r.x.p.name).join(', ')} hace menos de dos meses
                  ({wash.flatMap((r) => r.wash.map((e) => date(e.d))).join(', ')}). Si esas compras siguen en cartera, la pérdida
                  de esa venta no se puede compensar todavía; esta cuenta no lo descuenta.
                </span>
              </p>
            )}
            <ul className="rows">
              {sim.rows.map((r) => (
                <li key={r.x.p.isin}>
                  <button type="button" onClick={() => onOpen(r.x.p.isin)}>
                    <Asset p={r.x.p} size="sm">{qty(r.sh)} uds. a {eur(r.price)} · {r.x.p.lots.length > 1 ? 'los lotes más antiguos primero' : 'un lote'}</Asset>
                    <span className="row-r"><span className={`row-v ${sign(r.gain)}`}>{eurS(r.gain)}</span><small>cobras {eur(r.proceeds)}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : <Empty>Marca alguna posición para ver el efecto de venderla.</Empty>}
        <p className="note">
          Orientativo: ventas de hoy al precio actual. Las pérdidas compensan primero las ganancias del año y después hasta el
          25 % de dividendos e intereses; lo que sobra queda pendiente. Para que una pérdida cuente no puedes recomprar el mismo
          valor en los dos meses siguientes.
        </p>
      </Card>
    </div>
  );
}
