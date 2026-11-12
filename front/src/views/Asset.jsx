import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Avatar, Card, Delta, Empty, Icon, Kind, Pill, PriceInput, Seg, Stat } from '../components/ui.jsx';
import { Lines } from '../charts.jsx';
import { country, classLabel, sector } from '../lib/countries.js';
import { simulateSale, savingsTax } from '../lib/calc.js';
import { eur, eurS, num, pct, pctS, qty, sign, date, dateLong, time } from '../lib/format.js';

const RANGES = [['1', '1M'], ['3', '3M'], ['6', '6M'], ['ytd', 'YTD'], ['12', '1A'], ['max', 'Máx']];
const today = () => new Date().toISOString().slice(0, 10);
const shift = (d, days) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Una operación con su cuenta paso a paso y el estado de la posición después. */
function Op({ x }) {
  return (
    <li className="op">
      <div className="op-h">
        <span><Kind k={x.k} /> <span className="op-d">{date(x.d)}</span></span>
        <b className={x.k === 'S' ? sign(x.re) : ''}>
          {x.k === 'B' ? eur(x.net) : x.k === 'S' ? eurS(x.re) : eur(x.net)}
        </b>
      </div>
      <div className="op-b">
        {x.k === 'B' && (
          <>
            {qty(x.sh)} × {eur(x.px)} = {num(x.g)} + comisión {num(x.fee)}{x.tax ? ` + impuesto ${num(x.tax)}` : ''} = <b>{eur(x.net)}</b><br />
            Después: {qty(x.sa)} uds. · coste {eur(x.ca)} · medio {eur(x.av)}
            {x.note && <><br /><i>{x.note}</i></>}
          </>
        )}
        {x.k === 'S' && (
          <>
            {qty(x.sh)} × {eur(x.px)} = {num(x.g)} − comisión {num(x.fee)} = <b>{eur(x.net)}</b> cobrados<br />
            Coste vendido: {qty(x.sh)} × {num(x.avb)} (precio medio) = {eur(x.cs)}<br />
            Resultado: {num(x.net)} − {num(x.cs)} = <b className={sign(x.re)}>{eurS(x.re)}</b>
            {Math.abs(x.reF - x.re) >= 0.005 && <> · por FIFO {eurS(x.reF)}</>}<br />
            Después: {qty(x.sa)} uds. · coste {eur(x.ca)}
          </>
        )}
        {x.k === 'D' && (
          <>
            {qty(x.sh)} uds. · bruto {num(x.g)} − retención {num(x.tax)} = <b>{eur(x.net)}</b>
            {x.orig && <> · original {x.orig}</>}
          </>
        )}
        {x.parts && (
          <span className="op-parts">
            Orden en {x.parts.length} ejecuciones: {x.parts.map((f) => `${qty(f.sh)} × ${num(f.px)}`).join(' + ')}
          </span>
        )}
        <span className="op-id" title="Últimos 8 caracteres del transaction_id del CSV">ID {(x.ids ?? [x.id]).join(' · ')}</span>
      </div>
    </li>
  );
}

/** Qué pasaría, fiscalmente, si vendieras hoy parte de la posición (FIFO). */
function Simulator({ p, yearBase }) {
  const [sh, setSh] = useState(String(+p.sh.toFixed(6)));
  const [price, setPrice] = useState(p.price > 0 ? String(+p.price.toFixed(4)) : '');
  const n = Math.min(p.sh, parseFloat(sh.replace(',', '.')) || 0), px = parseFloat(price.replace(',', '.')) || 0;
  const sim = n > 0 && px > 0 ? simulateSale(p.lots, n, px) : null;
  // Impuesto marginal: lo que sube la cuota del año al añadir esta ganancia (o lo que baja con una pérdida).
  const tax = sim ? savingsTax(Math.max(0, yearBase.gains + sim.gain) + yearBase.divs) - savingsTax(Math.max(0, yearBase.gains) + yearBase.divs) : 0;
  return (
    <Card title="Simular una venta" sub="Resultado fiscal por FIFO si vendieras ahora">
      <div className="sim-f">
        <label><span>Unidades</span>
          <input type="text" inputMode="decimal" value={sh} onChange={(ev) => setSh(ev.target.value)} aria-label="Unidades a vender" /></label>
        <label><span>Precio (€)</span>
          <input type="text" inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} aria-label="Precio de venta en euros" /></label>
      </div>
      <div className="seg sim-q" role="group" aria-label="Fracción de la posición">
        {[25, 50, 75, 100].map((f) => <button type="button" key={f} onClick={() => setSh(String(+((p.sh * f) / 100).toFixed(6)))}>{f} %</button>)}
      </div>
      {sim ? (
        <>
          <div className="calc">
            <div><span>Cobrarías ({qty(n)} × {num(px)} − 1 € de comisión)</span><b>{eur(sim.proceeds)}</b></div>
            <div><span>− Coste de adquisición FIFO ({sim.used.length} {sim.used.length === 1 ? 'lote' : 'lotes'})</span><b>−{eur(sim.cost)}</b></div>
            <div className="t"><span>= Resultado</span><b className={sign(sim.gain)}>{eurS(sim.gain)}</b></div>
            <div><span>{tax >= 0 ? 'Impuesto estimado' : 'Ahorro fiscal estimado'}</span><b>{eur(Math.abs(tax))}</b></div>
            <div className="t"><span>Te quedaría tras impuestos</span><b>{eur(sim.proceeds - tax)}</b></div>
          </div>
          <p className="note">
            Lotes que se consumirían: {sim.used.map((l) => `${date(l.d)} (${qty(l.sh)} a ${num(l.unit)})`).join(', ')}. El impuesto es
            el efecto sobre tu base del ahorro de este año ({eur(Math.max(0, yearBase.gains) + yearBase.divs)} hasta ahora); orientativo.
          </p>
        </>
      ) : <Empty>Indica unidades y precio.</Empty>}
    </Card>
  );
}

/** Valoraciones con fecha de un activo que no cotiza. */
function Valuations({ p, onPrice, onChange }) {
  const [rows, setRows] = useState(null);
  const [d, setD] = useState(today());
  const [price, setPrice] = useState('');
  const [err, setErr] = useState(null);
  useEffect(() => {
    api.getValuations().then((r) => setRows(r.valuations[p.isin] ?? [])).catch((e) => setErr(e.message));
  }, [p.isin, p.price]);
  const add = async (ev) => {
    ev.preventDefault();
    const n = parseFloat(price.replace(',', '.'));
    if (!(n > 0) || !d) return;
    try {
      const r = await api.setValuation(p.isin, d, n);
      const list = r.valuations[p.isin] ?? [];
      setRows(list);
      setPrice('');
      // La más reciente pasa a ser el precio actual.
      if (list.at(-1)?.d === d) onPrice(p.isin, n); else onChange();
    } catch (e) { setErr(e.message); }
  };
  const del = async (day) => {
    try { setRows((await api.deleteValuation(p.isin, day)).valuations[p.isin] ?? []); onChange(); } catch (e) { setErr(e.message); }
  };
  return (
    <Card title="Valoraciones" sub="Anota el valor por unidad en una fecha; el histórico las une en línea recta">
      {err && <p className="note loss">{err}</p>}
      <form className="val-f" onSubmit={add}>
        <input type="date" value={d} max={today()} onChange={(ev) => setD(ev.target.value)} aria-label="Fecha de la valoración" required />
        <input type="text" inputMode="decimal" placeholder="Precio €" value={price} onChange={(ev) => setPrice(ev.target.value)} aria-label="Precio por unidad en euros" required />
        <button type="submit" className="btn pri">Añadir</button>
      </form>
      {rows?.length ? (
        <ul className="vals">
          {[...rows].reverse().map((v) => (
            <li key={v.d}>
              <span>{date(v.d)}</span><b>{eur(v.price)}</b>
              <button type="button" className="icon" aria-label={`Borrar la valoración del ${date(v.d)}`} onClick={() => del(v.d)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      ) : rows && <Empty>Todavía no hay valoraciones anotadas.</Empty>}
    </Card>
  );
}

export default function Asset({ x, totalVal, yearBase, onBack, onPrice, liveQuotes, onHistoryChange }) {
  const { p } = x;
  const [range, setRange] = useState('max');
  const [hist, setHist] = useState(undefined); // undefined = cargando; null = sin cotización
  const [hover, setHover] = useState(null);
  const first = p.evs[0].d;
  const quoted = p.priceSource === 'live' || (!!p.sector || p.cls === 'FUND') && p.grp === 'ac';

  useEffect(() => {
    let alive = true;
    setHist(undefined);
    api.getAssetHistory(p.isin, shift(first, -120))
      .then((r) => alive && setHist(r.asset?.rows?.length ? r.asset : null))
      .catch(() => alive && setHist(null));
    return () => { alive = false; };
  }, [p.isin, first]);

  // Serie visible: cierres en euros y, para lo que sigue en cartera, la cotización actual al final.
  const view = useMemo(() => {
    if (!hist) return null;
    let rows = hist.rows;
    if (p.open && p.price > 0 && rows.at(-1)[0] < today()) rows = [...rows, [today(), p.price]];
    let from = rows[0][0];
    if (range === 'ytd') from = `${new Date().getFullYear()}-01-01`;
    else if (range !== 'max') { const d = new Date(); d.setMonth(d.getMonth() - Number(range)); from = d.toISOString().slice(0, 10); }
    rows = rows.filter(([d]) => d >= from);
    if (rows.length < 2) return null;
    const dates = rows.map((r) => r[0]);
    const idx = (d) => { const i = dates.findIndex((k) => k >= d); return i < 0 ? dates.length - 1 : i; };
    const marks = x.ops.filter((o) => o.k !== 'D' && o.d >= dates[0])
      .map((o) => ({ key: o.id + o.k, i: idx(o.d), cls: o.k === 'B' ? 'buy' : 'sell', o }));
    return { t: dates.map((d) => Date.parse(`${d}T00:00:00Z`)), dates, c: rows.map((r) => r[1]), marks };
  }, [hist, range, p.open, p.price, x.ops]);

  const chg = view ? (view.c.at(-1) / view.c[0] - 1) * 100 : null;
  const hv = view && hover != null ? { c: view.c[hover], d: view.dates[hover], chg: (view.c[hover] / view.c[0] - 1) * 100 } : null;
  const totalRet = p.open && x.has ? x.pl + x.div : null;

  return (
    <div className="asset-page">
      <header className="asset-h">
        <button type="button" className="icon-btn" aria-label="Volver" onClick={onBack}><Icon name="back" /></button>
        <Avatar p={p} size="lg" />
        <div className="drawer-t">
          <h1>{p.name}</h1>
          <p>
            {p.priceInfo?.symbol && <>{p.priceInfo.symbol} · </>}{p.isin} · {p.sector ? sector(p) : classLabel(p.cls)} · {country(p.isin)}
            {!p.open && ' · posición cerrada'}
          </p>
        </div>
      </header>

      <div className="dash">
        <div className="dash-main">
          <section className="hero">
            <span className="eyebrow">{hv ? dateLong(Date.parse(`${hv.d}T00:00:00Z`)) : p.open ? 'Precio actual' : 'Último precio'}</span>
            <div className="hero-v">{hv ? eur(hv.c) : p.price > 0 ? eur(p.price) : view ? eur(view.c.at(-1)) : '—'}</div>
            <div className="hero-d">
              {hv ? <span className={`chg ${sign(hv.chg)}`}>{pctS(hv.chg)} <em>en el periodo hasta ese día</em></span> : (
                <>
                  {chg != null && <span className={`chg ${sign(chg)}`}><span aria-hidden="true">{chg >= 0 ? '▲' : '▼'}</span> {pctS(chg)} <em>en el periodo</em></span>}
                  {x.dayPct != null && <span className={`chg ${sign(x.dayPct)}`}><span aria-hidden="true">{x.dayPct >= 0 ? '▲' : '▼'}</span> {pctS(x.dayPct)} <em>última sesión</em></span>}
                </>
              )}
            </div>
          </section>

          <section className="chart-block">
            {view ? (
              <Lines x={view.t} height={300} label={`Precio de ${p.name} en euros`} base={p.open ? x.avg : undefined}
                onHover={setHover} marks={view.marks}
                series={[{ key: 'c', values: view.c, cls: chg >= 0 ? 'up' : 'down', area: true }]}
                tip={(i) => {
                  const ms = view.marks.filter((k) => k.i === i);
                  return (
                    <>
                      <small>{dateLong(view.t[i])}</small><b>{eur(view.c[i])}</b>
                      {ms.map((k) => <small key={k.key}>{k.o.k === 'B' ? 'Compra' : 'Venta'} {qty(k.o.sh)} × {eur(k.o.px)}</small>)}
                    </>
                  );
                }} />
            ) : hist === undefined ? <div className="sk" style={{ height: 300 }} />
              : <Empty>{hist ? 'No hay datos en este periodo.' : 'Este activo no tiene cotización pública: su valor se sigue con las valoraciones que anotes.'}</Empty>}
            {hist && (
              <>
                <div className="chart-f">
                  <ul className="legend flat">
                    <li><i className="dotk buy" />Compras</li>
                    <li><i className="dotk sell" />Ventas</li>
                    {p.open && <li><i className="sw dotted" />Tu precio medio ({eur(x.avg)})</li>}
                  </ul>
                  <Seg options={RANGES} value={range} onChange={setRange} label="Periodo" />
                </div>
              </>
            )}
          </section>

          {p.open ? (
            <Card title="Tu posición">
              <div className="perf">
                <div><span className="stat-l">Valor</span><b className="stat-v">{x.has ? eur(x.v) : '—'}</b></div>
                <div><span className="stat-l">Resultado</span><b className={`stat-v ${x.has ? sign(x.pl) : ''}`}>{x.has ? eurS(x.pl) : '—'}</b></div>
                <div><span className="stat-l">Rentabilidad</span><b className={`stat-v ${x.has ? sign(x.pl) : ''}`}>{x.has ? pctS(x.plp) : '—'}</b></div>
              </div>
              <div className="stats">
                <Stat label="Cantidad" value={qty(p.sh)} />
                <Stat label="Precio medio" value={eur(x.avg)} hint="precio de equilibrio" />
                <Stat label="Coste" value={eur(p.cost)} />
                <Stat label="Peso" value={x.w != null ? pct(x.w) : '—'} hint="del valor de la vista" />
                <Stat label="Dividendos netos" value={eur(x.div)} hint={x.D.length ? `${x.D.length} cobros · ${pct((x.div / p.cost) * 100)} s/coste` : 'sin cobros'} />
                <Stat label="Resultado + dividendos" value={totalRet != null ? eurS(totalRet) : '—'} tone={totalRet != null ? sign(totalRet) : ''}
                  hint={totalRet != null ? pctS((totalRet / p.cost) * 100) : ''} />
              </div>
            </Card>
          ) : (
            <Card title="Posición cerrada">
              <div className="perf">
                <div><span className="stat-l">Resultado realizado</span><b className={`stat-v ${sign(x.real)}`}>{eurS(x.real)}</b></div>
                <div><span className="stat-l">Rentabilidad</span><b className={`stat-v ${sign(x.real)}`}>{x.bought ? pctS((x.real / x.bought) * 100) : '—'}</b></div>
                <div><span className="stat-l">Dividendos netos</span><b className="stat-v">{eur(x.div)}</b></div>
              </div>
              <div className="stats">
                <Stat label="Invertido" value={eur(x.bought)} hint={`${x.B.length} compras`} />
                <Stat label="Cobrado (neto)" value={eur(x.bought + x.real)} hint={`${x.S.length} ventas`} />
              </div>
            </Card>
          )}

          {p.open && (
            <Card title="Cómo se calcula">
              <div className="calc">
                <div><span>Compras ({x.B.length})</span><b>{eur(x.bought)}</b></div>
                {x.S.length > 0 && <div><span>− Coste de lo vendido ({x.S.length} ventas)</span><b>−{eur(x.soldCost)}</b></div>}
                <div className="t"><span>= Coste de la posición</span><b>{eur(p.cost)}</b></div>
                <div><span>Precio medio = {num(p.cost)} ÷ {qty(p.sh)}</span><b>{eur(x.avg)}</b></div>
                {x.has && (
                  <>
                    <div><span>Valor = {qty(p.sh)} × {num(p.price)}</span><b>{eur(x.v)}</b></div>
                    <div className="t"><span>Resultado = {num(x.v)} − {num(p.cost)}</span><b className={sign(x.pl)}>{eurS(x.pl)} ({pctS(x.plp)})</b></div>
                    {totalVal > 0 && <div><span>Peso = {num(x.v)} ÷ {num(totalVal)}</span><b>{pct(x.w)}</b></div>}
                  </>
                )}
                {x.D.length > 0 && <div><span>Dividendos = bruto {num(x.divG)} − retención {num(x.divT)}</span><b>{eur(x.div)}</b></div>}
                {x.S.length > 0 && <div><span>Realizado en ventas anteriores</span><b className={sign(x.real)}>{eurS(x.real)}</b></div>}
              </div>
              {p.extra && <p className="note">{p.extra}</p>}
            </Card>
          )}
        </div>

        <aside className="dash-side">
          {p.open && (
            <Card title="Precio">
              <label className="price-row">
                <span>Precio actual (€)</span>
                <PriceInput p={p} onPrice={onPrice} />
              </label>
              {p.priceSource === 'live' && p.priceInfo ? (
                <p className="note">
                  <span className="live-dot" aria-hidden="true" /> En vivo · {p.priceInfo.symbol} · {p.priceInfo.exchange}.{' '}
                  {p.priceInfo.currency !== 'EUR' && <>{num(p.priceInfo.raw)} {p.priceInfo.currency} × {p.priceInfo.rate.toFixed(4)}. </>}
                  {p.priceInfo.time && <>Cotización del {date(p.priceInfo.time)} a las {time(p.priceInfo.time)}.</>}
                </p>
              ) : (
                <p className="note">
                  {p.priceAt ? `Fijado a mano el ${date(p.priceAt)}.` : 'Sin precio.'}{' '}
                  {p.priceSource === 'manual' && liveQuotes && quoted && (
                    <button type="button" className="link" onClick={() => onPrice(p.isin, null)}>Volver a la cotización en vivo</button>
                  )}
                </p>
              )}
            </Card>
          )}
          {p.open && hist === null && <Valuations p={p} onPrice={onPrice} onChange={onHistoryChange} />}
          {p.open && p.lots?.length > 0 && <Simulator key={p.isin} p={p} yearBase={yearBase} />}
          <Card title={`Operaciones (${x.ops.length})`}>
            <ul className="ops">{[...x.ops].reverse().map((e) => <Op key={e.id + e.k} x={e} />)}</ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}
