import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Avatar, Card, Empty, Icon, PriceInput, Seg, Tabs } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { Lines } from '../charts.jsx';
import { useParam } from '../router.js';
import { country, classLabel, sector } from '../lib/countries.js';
import { simulateSale, savingsTax } from '../../../shared/calc.js';
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
  const [steps, setSteps] = useState(false);
  const n = Math.min(p.sh, parseFloat(sh.replace(',', '.')) || 0), px = parseFloat(price.replace(',', '.')) || 0;
  const sim = n > 0 && px > 0 ? simulateSale(p.lots, n, px) : null;
  // Impuesto marginal: lo que sube la cuota del año al añadir esta ganancia (o lo que baja con una pérdida).
  const tax = sim ? savingsTax(saleBase(yearBase, sim.gain)) - savingsTax(saleBase(yearBase, 0)) : 0;
  const keep = sim ? sim.proceeds - tax : 0;
  const setPx = (v) => setPrice(String(+v.toFixed(4)));
  // Reparto de lo cobrado: lo que pagaste, lo que ganas y lo que se lleva Hacienda.
  const bar = sim && sim.proceeds > 0 && [
    ['cost', 'Coste recuperado', Math.min(sim.cost, sim.proceeds)],
    ['gain', 'Ganancia neta', Math.max(0, sim.gain - Math.max(0, tax))],
    ['tax', 'Impuesto', Math.max(0, tax)],
  ].filter(([, , v]) => v > 0.005);
  return (
    <div className="sim">
      <Card title="Simular una venta" sub="Qué te quedaría si vendieras ahora (criterio FIFO)">
        <div className="sim-f">
          <label><span>Unidades</span>
            <input type="text" inputMode="decimal" value={sh} onChange={(ev) => setSh(ev.target.value)} aria-label="Unidades a vender" /></label>
          <label><span>Precio de venta (€)</span>
            <input type="text" inputMode="decimal" value={price} onChange={(ev) => setPrice(ev.target.value)} aria-label="Precio de venta en euros" /></label>
        </div>
        <input type="range" className="sim-r" min="0" max={p.sh} step={p.sh / 100} value={n}
          onChange={(ev) => setSh(String(+Number(ev.target.value).toFixed(6)))} aria-label="Parte de la posición a vender" />
        <div className="sim-q">
          <span className="seg" role="group" aria-label="Fracción de la posición">
            {[25, 50, 75, 100].map((f) => <button type="button" key={f} className={Math.abs(n - (p.sh * f) / 100) < 1e-6 ? 'on' : ''}
              onClick={() => setSh(String(+((p.sh * f) / 100).toFixed(6)))}>{f} %</button>)}
          </span>
          {p.price > 0 && (
            <span className="seg" role="group" aria-label="Precio de venta">
              {[[-10, '−10 %'], [0, 'Actual'], [10, '+10 %']].map(([d, l]) => (
                <button type="button" key={d} className={Math.abs(px - p.price * (1 + d / 100)) < 0.0001 ? 'on' : ''} onClick={() => setPx(p.price * (1 + d / 100))}>{l}</button>
              ))}
            </span>
          )}
        </div>
      </Card>

      <Card title="Resultado">
        {sim ? (
          <>
            <span className="eyebrow">Te quedarías con</span>
            <div className="sim-v">{eur(keep)}</div>
            <p className="sim-s">
              <span className={sign(sim.gain)}>{eurS(sim.gain)}</span> de {sim.gain >= 0 ? 'ganancia' : 'pérdida'} ·{' '}
              {tax >= 0 ? `${eur(tax)} de impuesto estimado` : `${eur(-tax)} de ahorro fiscal`}
            </p>
            {bar?.length > 0 && (
              <>
                <div className="stackbar" role="img" aria-label="Reparto de lo cobrado">
                  {bar.map(([k, l, v]) => <i key={k} className={`sim-${k}`} style={{ flexGrow: v }} title={`${l}: ${eur(v)}`} />)}
                </div>
                <ul className="legend flat">
                  {bar.map(([k, l, v]) => <li key={k}><i className={`dotk sim-${k}`} />{l} <b>{eur(v)}</b></li>)}
                </ul>
              </>
            )}
            <h3 className="kv-h">Lotes que vendes (los más antiguos primero)</h3>
            <ul className="lots-l">
              {sim.used.map((l, i) => {
                const g = (px - l.unit) * l.sh;
                return (
                  <li key={i}>
                    <span>{date(l.d)}<small>{qty(l.sh)} uds. compradas a {eur(l.unit)}</small></span>
                    <b className={sign(g)}>{eurS(g)}</b>
                  </li>
                );
              })}
            </ul>
            <button type="button" className="fold" aria-expanded={steps} onClick={() => setSteps((v) => !v)}>
              {steps ? 'Ocultar el cálculo' : 'Ver el cálculo'}
            </button>
            {steps && (
              <>
                <div className="calc">
                  <div><span>Cobrarías ({qty(n)} × {num(px)} − 1 € de comisión)</span><b>{eur(sim.proceeds)}</b></div>
                  <div><span>− Coste de adquisición FIFO ({sim.used.length} {sim.used.length === 1 ? 'lote' : 'lotes'})</span><b>−{eur(sim.cost)}</b></div>
                  <div className="t"><span>= Resultado</span><b className={sign(sim.gain)}>{eurS(sim.gain)}</b></div>
                  <div><span>{tax >= 0 ? 'Impuesto estimado' : 'Ahorro fiscal estimado'}</span><b>{eur(Math.abs(tax))}</b></div>
                  <div className="t"><span>Te quedaría tras impuestos</span><b>{eur(keep)}</b></div>
                </div>
                <p className="note">
                  El impuesto es el efecto sobre tu base del ahorro de este año ({eur(saleBase(yearBase, 0))} hasta ahora); orientativo.
                  La ganancia de cada lote no descuenta la comisión.
                </p>
              </>
            )}
          </>
        ) : <Empty>Indica unidades y precio.</Empty>}
      </Card>
    </div>
  );
}

/** Alertas de precio: avisan (con la app abierta) cuando la cotización cruza el nivel. */
function Alerts({ p, alerts, patch, fail }) {
  const [dir, setDir] = useState('below');
  const [price, setPrice] = useState('');
  const add = async (ev) => {
    ev.preventDefault();
    const n = parseFloat(price.replace(',', '.'));
    if (!(n > 0) || (dir === 'move' && n > 100)) return;
    try {
      patch(await api.addAlert({ isin: p.isin, dir, price: n }));
      setPrice('');
      if (window.Notification?.permission === 'default') Notification.requestPermission();
    } catch (e) { fail(e); }
  };
  const del = async (id) => { try { patch(await api.deleteAlert(id)); } catch (e) { fail(e); } };
  const quick = (d) => { setDir(d < 0 ? 'below' : 'above'); setPrice(String(+(p.price * (1 + d / 100)).toFixed(2))); };
  const day = p.priceInfo?.dayPct;
  const pending = alerts.filter((al) => !al.triggered_at), fired = alerts.filter((al) => al.triggered_at);
  const item = (al) => {
    const dist = p.price > 0 && al.dir !== 'move' ? (al.price / p.price - 1) * 100 : null;
    return (
      <li key={al.id} className={al.triggered_at ? 'fired' : ''}>
        <span className={`al-i ${al.dir}`} aria-hidden="true"><Icon name="bell" size={15} /></span>
        <span className="al-t">
          {al.dir === 'move' ? <>Si se mueve un <b>±{pct(al.price)}</b> en un día</> : <>{al.dir === 'above' ? 'Si sube de' : 'Si baja de'} <b>{eur(al.price)}</b></>}
          <small>{al.triggered_at ? `Saltó el ${date(al.triggered_at)}`
            : al.dir === 'move' ? (Number.isFinite(day) ? `hoy lleva ${pctS(day)}` : 'pendiente')
            : dist != null ? `a ${pctS(dist)} del precio actual` : 'pendiente'}</small>
        </span>
        <button type="button" className="icon" aria-label="Borrar alerta" onClick={() => del(al.id)}><Icon name="trash" size={16} /></button>
      </li>
    );
  };
  return (
    <div className="cols">
      <Card title="Nueva alerta" sub="Te avisa cuando la cotización cruza el nivel o se mueve más de un porcentaje en el día. Con los avisos activados en el menú de tu cuenta, también con la app cerrada">
        {p.price > 0 && <p className="al-now">Precio actual <b>{eur(p.price)}</b></p>}
        <form className="val-f" onSubmit={add}>
          <Seg label="Sentido de la alerta" options={[['below', 'Baja de'], ['above', 'Sube de'], ['move', 'Se mueve ±']]} value={dir} onChange={(d) => { if ((d === 'move') !== (dir === 'move')) setPrice(''); setDir(d); }} />
          <input type="text" inputMode="decimal" placeholder={dir === 'move' ? '% en un día' : 'Precio €'} value={price} onChange={(ev) => setPrice(ev.target.value)}
            aria-label={dir === 'move' ? 'Variación del día en porcentaje' : 'Precio de la alerta en euros'} required />
          <button type="submit" className="btn pri">Crear</button>
        </form>
        {p.price > 0 && (
          <div className="al-q">
            <span className="mu">Rápido:</span>
            {[-10, -5, 5, 10].map((d) => <button key={d} type="button" className="btn soft" onClick={() => quick(d)}>{d > 0 ? '+' : '−'}{Math.abs(d)} %</button>)}
          </div>
        )}
      </Card>
      <Card title="Tus alertas" sub={pending.length ? `${pending.length} pendiente${pending.length === 1 ? '' : 's'}` : 'Ninguna pendiente'}>
        {alerts.length ? (
          <ul className="al-l">{pending.map(item)}{fired.map(item)}</ul>
        ) : <Empty>Crea una alerta para que te avisemos cuando el precio llegue a un nivel.</Empty>}
      </Card>
    </div>
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

/** Nota libre del activo: por qué lo tienes, qué vigilar. Se guarda al salir del campo. */
function NoteCard({ p, onNote }) {
  const [text, setText] = useState(p.note ?? '');
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (text.trim() === (p.note ?? '')) return;
    if (await onNote(p.isin, text)) { setSaved(true); setTimeout(() => setSaved(false), 1600); }
  };
  return (
    <Card title="Tu nota" sub="Por qué lo tienes, a qué precio venderías, qué vigilar">
      <div className="note-f">
        <textarea value={text} onChange={(ev) => setText(ev.target.value)} onBlur={save} maxLength={2000} aria-label={`Nota sobre ${p.name}`} placeholder="Escribe aquí tu tesis de inversión…" />
        <small role="status">{saved ? 'Guardada.' : 'Solo la ves tú. Se guarda al salir del campo.'}</small>
      </div>
    </Card>
  );
}

export default function Asset({ x, totalVal, yearBase, onBack, onPrice, liveQuotes, onHistoryChange, onAddOp, onRemoveOp, alerts = [], patch, fail, onNote }) {
  const { p } = x;
  const [range, setRange] = useParam('periodo', 'max', { 1: '1m', 3: '3m', 6: '6m', ytd: 'año', 12: '1a', max: 'max' });
  const [tab, setTab] = useParam('ver', 'resumen', { ops: 'operaciones', sim: 'simulador', alerts: 'alertas' });
  const [steps, setSteps] = useState(false);
  const [editPx, setEditPx] = useState(false);
  const [hist, setHist] = useState(undefined); // undefined = cargando; null = sin cotización
  const [bench, setBench] = useState(null); // MSCI World en euros, para comparar
  const [cmp, setCmp] = useState(false);
  const [hover, setHover] = useState(null);
  const first = p.evs[0].d;
  const quoted = p.priceSource === 'live' || p.quotable || (!!p.sector || p.cls === 'FUND') && p.grp === 'ac';

  useEffect(() => {
    let alive = true;
    setHist(undefined);
    api.getAssetHistory(p.isin, shift(first, -120))
      .then((r) => { if (!alive) return; setHist(r.asset?.rows?.length ? r.asset : null); setBench(r.bench?.rows?.length ? r.bench : null); })
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
  // Comparación: el valor y el índice en base 100 al inicio del periodo.
  const vs = useMemo(() => {
    if (!cmp || !view || !bench) return null;
    let j = 0, last = null;
    const b = view.dates.map((d) => { while (j < bench.rows.length && bench.rows[j][0] <= d) last = bench.rows[j++][1]; return last; });
    const b0 = b.find((v) => v != null);
    if (!b0) return null;
    return { me: view.c.map((c) => (c / view.c[0]) * 100), ix: b.map((v) => (v == null ? null : (v / b0) * 100)), name: bench.name };
  }, [cmp, view, bench]);
  const hv = view && hover != null ? { c: view.c[hover], d: view.dates[hover], chg: (view.c[hover] / view.c[0] - 1) * 100 } : null;
  const totalRet = p.open && x.has ? x.pl + x.div : null;

  const tabs = [
    ['resumen', 'Resumen'], ['ops', `Operaciones · ${x.ops.length}`],
    p.open && p.lots?.length > 0 && ['sim', 'Simular venta'],
    p.open && p.priceSource === 'live' && ['alerts', `Alertas${alerts.filter((al) => !al.triggered_at).length ? ` · ${alerts.filter((al) => !al.triggered_at).length}` : ''}`],
  ].filter(Boolean);
  const cur = tabs.some(([k]) => k === tab) ? tab : 'resumen';
  // De dónde sale el precio, en una línea.
  const info = p.priceInfo;
  const priceText = p.priceSource === 'live' && info?.nav
    ? ['Valor liquidativo', info.time && `del ${date(info.time)}`, info.name, 'lo publica la gestora, normalmente cada mes'].filter(Boolean).join(' · ')
    : p.priceSource === 'live' && info
      ? ['En vivo', info.symbol, info.exchange,
        info.currency && info.currency !== 'EUR' && `${num(info.raw)} ${info.currency} × ${isMasked() ? MASK : info.rate.toFixed(4)}`,
        info.time && `${date(info.time)} ${time(info.time)}`].filter(Boolean).join(' · ')
      : p.priceAt ? `Precio fijado a mano el ${date(p.priceAt)}` : 'Sin precio: escríbelo para valorar la posición';
  // Tu historia con el valor: desde cuándo, cuántas operaciones y a qué precios compraste.
  const story = (() => {
    const first = x.B[0]?.d;
    if (!first) return null;
    const days = (Date.now() - Date.parse(`${first}T00:00:00Z`)) / 86400000;
    const held = days >= 730 ? `${Math.floor(days / 365)} años` : days >= 60 ? `${Math.floor(days / 30.44)} meses` : `${Math.max(1, Math.round(days))} días`;
    const pxs = x.B.map((b) => b.px).filter((v) => v > 0);
    const n = (k, one, many) => { const c = x.ops.filter((o) => o.k === k).length; return c ? `${c} ${c === 1 ? one : many}` : null; };
    return {
      first, held: p.open ? held : `${held} desde entonces`,
      ops: [n('B', 'compra', 'compras'), n('S', 'venta', 'ventas'), n('D', 'dividendo', 'dividendos')].filter(Boolean).join(' · '),
      min: pxs.length ? Math.min(...pxs) : null, max: pxs.length ? Math.max(...pxs) : null,
    };
  })();
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
          {view && vs ? (
            <Lines x={view.t} height={300} label={`${p.name} frente al ${vs.name}, base 100`} base={100} onHover={setHover}
              series={[{ key: 'me', values: vs.me, cls: vs.me.at(-1) >= 100 ? 'up' : 'down', area: true }, { key: 'ix', values: vs.ix, cls: 'b1' }]}
              tip={(i) => (
                <>
                  <small>{dateLong(view.t[i])}</small>
                  <b>{p.name} {pctS(vs.me[i] - 100)}</b>
                  {vs.ix[i] != null && <small>{vs.name} {pctS(vs.ix[i] - 100)}</small>}
                </>
              )} />
          ) : view ? (
            <Lines x={view.t} height={300} scale={(v) => (isMasked() ? "" : num(v))} label={`Precio de ${p.name} en euros`} base={p.open ? x.avg : undefined}
              onHover={setHover} marks={view.marks}
              series={[{ key: 'c', values: view.c, cls: chg >= 0 ? 'up' : 'down', area: true }]}
              span={(i0, i1) => {
                const r = (view.c[i1] / view.c[i0] - 1) * 100;
                return <><small>{dateLong(view.t[i0])} → {dateLong(view.t[i1])}</small><b className={sign(r)}>{pctS(r)}</b><small>de {eur(view.c[i0])} a {eur(view.c[i1])}</small></>;
              }}
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
                {vs ? (
                  <ul className="legend flat">
                    <li><i className={`sw ${vs.me.at(-1) >= 100 ? 'up' : 'down'}`} />{p.name} {pctS(vs.me.at(-1) - 100)}</li>
                    <li><i className="sw b1" />{vs.name} {vs.ix.at(-1) != null ? pctS(vs.ix.at(-1) - 100) : ''}</li>
                  </ul>
                ) : (
                  <ul className="legend flat">
                    <li><i className="dotk buy" />Compras</li>
                    <li><i className="dotk sell" />Ventas</li>
                    {p.open && <li><i className="sw dotted" />Tu precio medio ({eur(x.avg)})</li>}
                  </ul>
                )}
                {bench && (
                  <button type="button" className={`btn soft cmp-b ${cmp ? 'on' : ''}`} aria-pressed={cmp} onClick={() => setCmp((v) => !v)}>
                    {cmp ? 'Ver el precio' : `Comparar con el ${bench.name}`}
                  </button>
                )}
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

      <Tabs label="Apartado" value={cur} onChange={setTab} items={tabs} />

      {cur === 'resumen' && (
        <div className="asset-sum">
          {story && (
            <dl className="facts">
              <div><dt>Primera compra</dt><dd>{story.held}</dd><small>{dateLong(Date.parse(`${story.first}T00:00:00Z`))}</small></div>
              <div><dt>Operaciones</dt><dd>{x.ops.length}</dd><small>{story.ops}</small></div>
              {story.min != null && (
                <div><dt>Precio de compra</dt><dd>{story.min === story.max ? eur(story.min) : `${eur(story.min)} – ${eur(story.max)}`}</dd>
                  <small>{story.min === story.max ? 'siempre el mismo' : 'el más bajo y el más alto'}</small></div>
              )}
              {p.open && p.price > 0 && (
                <div><dt>Frente a tu precio medio</dt><dd className={sign(p.price - x.avg)}>{pctS((p.price / x.avg - 1) * 100)}</dd>
                  <small>medio {eur(x.avg)} · ahora {eur(p.price)}</small></div>
              )}
            </dl>
          )}

          {p.open && (
            <section className="price-strip">
              <p className="ps-src">
                {p.priceSource === 'live' && <span className="live-dot" aria-hidden="true" />}
                <span>{priceText}</span>
              </p>
              <div className="ps-act">
                {p.priceSource !== 'live' || editPx
                  ? <label className="ps-in"><span>Precio a mano (€)</span><PriceInput p={p} onPrice={onPrice} /></label>
                  : <button type="button" className="btn soft" onClick={() => setEditPx(true)}>Fijar un precio a mano</button>}
                {p.priceSource === 'manual' && liveQuotes && quoted && (
                  <button type="button" className="link" onClick={() => onPrice(p.isin, null)}>Volver a la cotización en vivo</button>
                )}
              </div>
            </section>
          )}

          {p.open && hist === null && (isMasked() ? <Hidden title="Valoraciones" /> : <Valuations p={p} onPrice={onPrice} onChange={onHistoryChange} />)}

          <NoteCard key={p.isin} p={p} onNote={onNote} />
          <Card title={p.open ? 'Cómo se calcula' : 'Resultado'}
            sub={totalRet != null ? `Resultado + dividendos: ${eurS(totalRet)}${p.cost > 0 ? ` (${pctS((totalRet / p.cost) * 100)})` : ''}` : undefined}>
            <button type="button" className="fold" aria-expanded={steps} onClick={() => setSteps((v) => !v)}>
              {steps ? 'Ocultar las cuentas' : 'Ver las cuentas paso a paso'}
            </button>
            {steps && (
              <div className="steps-in">
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
              </div>
            )}
            {p.extra && <p className="note">{maskText(p.extra)}</p>}
          </Card>
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
