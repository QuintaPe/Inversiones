import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Avatar, Card, Empty, Icon, PriceInput, Seg } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { Lines } from '../charts.jsx';
import { country, classLabel, sector } from '../lib/countries.js';
import { simulateSale, savingsTax } from '../lib/calc.js';
import { eur, eurS, num, pct, pctS, qty, sign, date, dateLong, time, isMasked, MASK, maskText } from '../lib/format.js';
// Base del ahorro del año si se añade un resultado: las pérdidas compensan hasta el 25 % de los rendimientos.
const saleBase = (b, gain) => { const g = b.gains + gain; return Math.max(0, g) + b.divs - Math.min(Math.max(0, -g), 0.25 * b.divs); };

const RANGES = [['1', '1M'], ['3', '3M'], ['6', '6M'], ['ytd', 'YTD'], ['12', '1A'], ['max', 'Máx']];
const today = () => new Date().toISOString().slice(0, 10);
const shift = (d, days) => new Date(Date.parse(`${d}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

/** Una operación con su cuenta paso a paso y el estado de la posición después. */
function OpDetail({ x, onEdit, onRemove }) {
  const manual = !x.parts && x.tid?.startsWith('manual-');
  return (
    <div className="tl-d">
      <div className="op-b">
        {x.k === 'B' && (
          <>
            {qty(x.sh)} × {eur(x.px)} = {num(x.g)} + comisión {num(x.fee)}{x.tax ? ` + impuesto ${num(x.tax)}` : ''} = <b>{eur(x.net)}</b><br />
            Después: {qty(x.sa)} uds. · coste {eur(x.ca)} · medio {eur(x.av)}
            {x.note && <><br /><i>{maskText(x.note)}</i></>}
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
        {x.k === 'X' && (
          <>
            {qty(x.from)} uds. × {num(x.ratio)} = <b>{qty(x.sh)} uds.</b><br />
            Después: {qty(x.sa)} uds. · coste {eur(x.ca)} · medio {eur(x.av)}<br />
            <i>El coste total no cambia; solo se reparte entre {x.ratio > 1 ? 'más' : 'menos'} acciones.</i>
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
        <span className="op-f">
          {x.k === 'X' ? <span className="op-id">Aplicado automáticamente con el histórico de cotizaciones</span> : (
            <>
              <span className="op-id" title="Últimos 8 caracteres del transaction_id del CSV">{manual ? 'Añadida a mano' : `ID ${(x.ids ?? [x.id]).join(' · ')}`}</span>
              {manual && <button type="button" className="link" onClick={() => onEdit(x)}>Editar</button>}
              <button type="button" className="link" onClick={() => onRemove(x)}>Quitar</button>
            </>
          )}
        </span>
      </div>
    </div>
  );
}

const KIND_NAME = { B: 'Compra', S: 'Venta', D: 'Dividendo', X: 'Split' };
/** Una operación en una línea; al pulsarla se despliega su cuenta paso a paso. */
function OpRow({ x, open, onToggle, onEdit, onRemove }) {
  const amount = x.k === 'X' ? `× ${num(x.ratio)}` : x.k === 'B' ? `−${eur(x.net)}` : eurS(x.net);
  const what = x.k === 'D' ? `${qty(x.sh)} uds. · retención ${eur(x.tax)}`
    : x.k === 'X' ? `${qty(x.from)} → ${qty(x.sh)} uds.`
    : `${qty(x.sh)} × ${eur(x.px)}${x.fee ? ` · comisión ${eur(x.fee)}` : ''}`;
  return (
    <li className={`tl-i k-${x.k} ${open ? 'open' : ''}`}>
      <button type="button" className="tl-b" aria-expanded={open} onClick={onToggle}>
        <span className="tl-dot" aria-hidden="true" />
        <span className="tl-main">
          <span className="tl-t"><b>{KIND_NAME[x.k]}</b> {what}</span>
          <small>
            {date(x.d)}
            {x.sa != null && x.k !== 'D' && ` · después ${qty(x.sa)} uds.${x.av ? ` a ${eur(x.av)}` : ''}`}
            {x.parts && ` · ${x.parts.length} ejecuciones`}
          </small>
        </span>
        <span className="row-r">
          <span className={`row-v ${x.k === 'B' || x.k === 'X' ? '' : 'gain'}`}>{amount}</span>
          {x.k === 'S' && <small className={sign(x.re)}>{eurS(x.re)} resultado</small>}
        </span>
        <Icon name="chevron" size={16} />
      </button>
      {open && <OpDetail x={x} onEdit={onEdit} onRemove={onRemove} />}
    </li>
  );
}

/** Todas las operaciones del activo: filtro por tipo y línea de tiempo por años. */
function OpsTimeline({ ops, onEdit, onRemove }) {
  const [k, setK] = useState('all');
  const [open, setOpen] = useState(null);
  const n = (t) => ops.filter((o) => o.k === t).length;
  const kinds = [['all', `Todas · ${ops.length}`], ['B', `Compras · ${n('B')}`], ['S', `Ventas · ${n('S')}`], ['D', `Dividendos · ${n('D')}`]]
    .filter(([t], i) => i === 0 || n(t) > 0);
  const list = [...ops].reverse().filter((o) => k === 'all' || o.k === k);
  const years = [];
  for (const o of list) {
    const y = o.d.slice(0, 4);
    if (years.at(-1)?.y !== y) years.push({ y, items: [] });
    years.at(-1).items.push(o);
  }
  return (
    <>
      {kinds.length > 2 && <Seg label="Tipo de operación" options={kinds} value={k} onChange={setK} />}
      {years.map(({ y, items }) => (
        <section key={y} className="tl-y">
          <h3 className="kv-h">{y}</h3>
          <ul className="tl">
            {items.map((o) => {
              const id = o.id + o.k;
              return <OpRow key={id} x={o} open={open === id} onToggle={() => setOpen(open === id ? null : id)} onEdit={onEdit} onRemove={onRemove} />;
            })}
          </ul>
        </section>
      ))}
    </>
  );
}


/** Tarjeta en lugar de un formulario con cifras cuando los importes están ocultos. */
const Hidden = ({ title }) => (
  <Card title={title}><p className="note">Importes ocultos. Muéstralos con el botón del ojo de la barra superior para usar esta sección.</p></Card>
);

/** Qué pasaría, fiscalmente, si vendieras hoy parte de la posición (FIFO). */
function Simulator({ p, yearBase }) {
  const [sh, setSh] = useState(String(+p.sh.toFixed(6)));
  const [price, setPrice] = useState(p.price > 0 ? String(+p.price.toFixed(4)) : '');
  const n = Math.min(p.sh, parseFloat(sh.replace(',', '.')) || 0), px = parseFloat(price.replace(',', '.')) || 0;
  const sim = n > 0 && px > 0 ? simulateSale(p.lots, n, px) : null;
  // Impuesto marginal: lo que sube la cuota del año al añadir esta ganancia (o lo que baja con una pérdida).
  const tax = sim ? savingsTax(saleBase(yearBase, sim.gain)) - savingsTax(saleBase(yearBase, 0)) : 0;
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
            el efecto sobre tu base del ahorro de este año ({eur(saleBase(yearBase, 0))} hasta ahora); orientativo.
          </p>
        </>
      ) : <Empty>Indica unidades y precio.</Empty>}
    </Card>
  );
}

/** Alertas de precio: avisan (con la app abierta) cuando la cotización cruza el nivel. */
function Alerts({ p, alerts, patch, fail }) {
  const [dir, setDir] = useState('below');
  const [price, setPrice] = useState('');
  const add = async (ev) => {
    ev.preventDefault();
    const n = parseFloat(price.replace(',', '.'));
    if (!(n > 0)) return;
    try {
      patch(await api.addAlert({ isin: p.isin, dir, price: n }));
      setPrice('');
      if (window.Notification?.permission === 'default') Notification.requestPermission();
    } catch (e) { fail(e); }
  };
  const del = async (id) => { try { patch(await api.deleteAlert(id)); } catch (e) { fail(e); } };
  return (
    <Card title="Alertas de precio" sub="Te avisa cuando la cotización cruza el nivel. Con los avisos activados en el menú de tu cuenta, también con la app cerrada">
      <form className="val-f" onSubmit={add}>
        <Seg label="Sentido de la alerta" options={[['below', 'Baja de'], ['above', 'Sube de']]} value={dir} onChange={setDir} />
        <input type="text" inputMode="decimal" placeholder={p.price > 0 ? `p. ej. ${num(p.price * (dir === 'below' ? 0.9 : 1.1))}` : 'Precio €'}
          value={price} onChange={(ev) => setPrice(ev.target.value)} aria-label="Precio de la alerta en euros" required />
        <button type="submit" className="btn pri">Crear</button>
      </form>
      {alerts.length > 0 && (
        <ul className="vals">
          {alerts.map((al) => (
            <li key={al.id}>
              <span>{al.dir === 'above' ? 'Si sube de' : 'Si baja de'} <b>{eur(al.price)}</b>{al.triggered_at && <em className="fired"> · saltó el {date(al.triggered_at)}</em>}</span>
              <button type="button" className="icon" aria-label="Borrar alerta" onClick={() => del(al.id)}><Icon name="trash" size={16} /></button>
            </li>
          ))}
        </ul>
      )}
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

export default function Asset({ x, totalVal, yearBase, onBack, onPrice, liveQuotes, onHistoryChange, onAddOp, onRemoveOp, alerts = [], patch, fail }) {
  const { p } = x;
  const [range, setRange] = useState('max');
  const [tab, setTab] = useState('resumen');
  const [hist, setHist] = useState(undefined); // undefined = cargando; null = sin cotización
  const [hover, setHover] = useState(null);
  const first = p.evs[0].d;
  const quoted = p.priceSource === 'live' || p.quotable || (!!p.sector || p.cls === 'FUND') && p.grp === 'ac';

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
    const marks = x.ops.filter((o) => (o.k === 'B' || o.k === 'S') && o.d >= dates[0])
      .map((o) => ({ key: o.id + o.k, i: idx(o.d), cls: o.k === 'B' ? 'buy' : 'sell', o }));
    return { t: dates.map((d) => Date.parse(`${d}T00:00:00Z`)), dates, c: rows.map((r) => r[1]), marks };
  }, [hist, range, p.open, p.price, x.ops]);

  const chg = view ? (view.c.at(-1) / view.c[0] - 1) * 100 : null;
  const hv = view && hover != null ? { c: view.c[hover], d: view.dates[hover], chg: (view.c[hover] / view.c[0] - 1) * 100 } : null;
  const totalRet = p.open && x.has ? x.pl + x.div : null;

  const tabs = [
    ['resumen', 'Resumen'], ['ops', `Operaciones · ${x.ops.length}`],
    p.open && p.lots?.length > 0 && ['sim', 'Simular venta'],
    p.open && p.priceSource === 'live' && ['alerts', `Alertas${alerts.filter((al) => !al.triggered_at).length ? ` · ${alerts.filter((al) => !al.triggered_at).length}` : ''}`],
  ].filter(Boolean);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'resumen';
  const addOp = () => onAddOp({ isin: p.isin, name: p.name, asset_class: p.cls });

  return (
    <div className="asset-page stack">
      <header className="asset-h">
        <button type="button" className="icon-btn" aria-label="Volver" onClick={onBack}><Icon name="back" /></button>
        <Avatar p={p} size="lg" />
        <div className="asset-ht">
          <h1>{p.name}</h1>
          <p className="chips">
            {p.priceInfo?.symbol && <span>{p.priceInfo.symbol}</span>}
            <span className="mono">{p.isin}</span>
            <span>{p.sector ? sector(p) : classLabel(p.cls)}</span>
            <span>{country(p.isin)}</span>
            {!p.open && <span className="closed">Posición cerrada</span>}
          </p>
        </div>
        <button type="button" className="btn pri asset-add" onClick={addOp}><Icon name="plus" size={16} /><span className="hide-s">Añadir operación</span></button>
      </header>

        <section className="hero">
          <span className="eyebrow">{hv ? dateLong(Date.parse(`${hv.d}T00:00:00Z`)) : p.open ? 'Precio actual' : 'Último precio'}</span>
          <div className="hero-v">{hv ? eur(hv.c) : p.price > 0 ? eur(p.price) : view ? eur(view.c.at(-1)) : '—'}</div>
          {/* Misma altura con y sin cursor sobre la gráfica (ver el resumen). */}
          <div className={`hero-sw ${hv ? 'hovering' : ''}`}>
            <div className="hero-d hero-base">
              {chg != null && <span className={`chg ${sign(chg)}`}><span aria-hidden="true">{chg >= 0 ? '▲' : '▼'}</span> {pctS(chg)} <em>en el periodo</em></span>}
              {x.dayPct != null && <span className={`chg ${sign(x.dayPct)}`}><span aria-hidden="true">{x.dayPct >= 0 ? '▲' : '▼'}</span> {pctS(x.dayPct)} <em>última sesión</em></span>}
              {chg == null && x.dayPct == null && <span className="chg">&nbsp;</span>}
            </div>
            {hv && <div className="hero-d hero-over"><span className={`chg ${sign(hv.chg)}`}>{pctS(hv.chg)} <em>en el periodo hasta ese día</em></span></div>}
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
        <div className="kpis-row">
          <Kpi label="Tu posición" value={x.has ? eur(x.v) : '—'} sub={`${qty(p.sh)} uds.${x.w != null ? ` · ${pct(x.w)} de la cartera` : ''}`} />
          <Kpi label="Resultado" value={x.has ? eurS(x.pl) : '—'} tone={x.has ? sign(x.pl) : ''} sub={x.has && x.plp != null ? `${pctS(x.plp)} desde la compra` : 'sin precio'} />
          <Kpi label="Precio medio" value={eur(x.avg)} sub={`coste ${eur(p.cost)}`} />
          <Kpi label="Dividendos" value={eur(x.div)} sub={x.D.length ? `${x.D.length} cobros${p.cost > 0 ? ` · ${pct((x.div / p.cost) * 100)} s/ coste` : ''}` : 'sin cobros'} />
        </div>
      ) : (
        <div className="kpis-row">
          <Kpi label="Resultado realizado" value={eurS(x.real)} tone={sign(x.real)} sub={x.bought ? `${pctS((x.real / x.bought) * 100)} sobre lo invertido` : ''} />
          <Kpi label="Invertido" value={eur(x.bought)} sub={`${x.B.length} compras`} />
          <Kpi label="Cobrado (neto)" value={eur(x.bought + x.real)} sub={`${x.S.length} ventas`} />
          <Kpi label="Dividendos" value={eur(x.div)} sub={x.D.length ? `${x.D.length} cobros` : 'sin cobros'} />
        </div>
      )}

      <div className="utabs" role="tablist" aria-label="Apartado">
        {tabs.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={cur === k} className={cur === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {cur === 'resumen' && (
        <div className="cols">
          <Card title={p.open ? 'Cómo se calcula' : 'Resultado'} sub={totalRet != null ? `Resultado + dividendos: ${eurS(totalRet)}${p.cost > 0 ? ` (${pctS((totalRet / p.cost) * 100)})` : ''}` : undefined}>
            {p.open ? (
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
            ) : (
              <div className="calc">
                <div><span>Compras ({x.B.length})</span><b>{eur(x.bought)}</b></div>
                <div><span>Cobrado en ventas, neto ({x.S.length})</span><b>{eur(x.bought + x.real)}</b></div>
                <div className="t"><span>= Resultado realizado (coste medio)</span><b className={sign(x.real)}>{eurS(x.real)}</b></div>
                {x.D.length > 0 && <div><span>Dividendos = bruto {num(x.divG)} − retención {num(x.divT)}</span><b>{eur(x.div)}</b></div>}
              </div>
            )}
            {p.extra && <p className="note">{maskText(p.extra)}</p>}
          </Card>
          <div className="stack">
            {p.open && (
              <Card title="Precio">
                <label className="price-row">
                  <span>Precio actual (€)</span>
                  <PriceInput p={p} onPrice={onPrice} />
                </label>
                {p.priceSource === 'live' && p.priceInfo?.nav ? (
                  <p className="note">
                    <span className="live-dot" aria-hidden="true" /> Valor liquidativo{p.priceInfo.time && <> del {date(p.priceInfo.time)}</>}
                    {p.priceInfo.name && <> · {p.priceInfo.name}</>}. Lo publica la gestora, normalmente una vez al mes; se actualiza solo.
                  </p>
                ) : p.priceSource === 'live' && p.priceInfo ? (
                  <p className="note">
                    <span className="live-dot" aria-hidden="true" /> En vivo · {p.priceInfo.symbol} · {p.priceInfo.exchange}.{' '}
                    {p.priceInfo.currency !== 'EUR' && <>{num(p.priceInfo.raw)} {p.priceInfo.currency} × {isMasked() ? MASK : p.priceInfo.rate.toFixed(4)}. </>}
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
            {p.open && hist === null && (isMasked() ? <Hidden title="Valoraciones" /> : <Valuations p={p} onPrice={onPrice} onChange={onHistoryChange} />)}
            {!p.open && <Card title="Posición cerrada"><p className="note">Ya no tienes acciones de este valor: su resultado quedó realizado en las ventas.</p></Card>}
          </div>
        </div>
      )}

      {cur === 'ops' && (
        <Card title="Operaciones" sub="De la más reciente a la más antigua · pulsa una para ver la cuenta"
          right={<button type="button" className="btn" onClick={addOp}><Icon name="plus" size={15} />Añadir</button>}>
          <OpsTimeline ops={x.ops} onRemove={onRemoveOp}
            onEdit={(o) => onAddOp({
              tid: o.tid, type: { B: 'BUY', S: 'SELL', D: 'DIVIDEND' }[o.k], isin: p.isin, name: p.name, asset_class: p.cls, date: o.d,
              shares: o.sh, price: o.px, fee: o.fee, tax: o.tax, amount: o.g,
            })} />
        </Card>
      )}

      {cur === 'sim' && (isMasked() ? <Hidden title="Simular una venta" /> : <Simulator key={p.isin} p={p} yearBase={yearBase} />)}
      {cur === 'alerts' && (isMasked() ? <Hidden title="Alertas de precio" /> : <Alerts p={p} alerts={alerts} patch={patch} fail={fail} />)}
    </div>
  );
}
