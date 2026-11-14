// Seguimiento: valores que no tienes pero quieres vigilar, con su precio y la variación del día.
import { useEffect, useState } from 'react';
import * as api from '../api.js';
import { Card, Empty, Icon } from '../components/ui.jsx';
import { eur, pctS, sign, time } from '../lib/format.js';

export default function Watch({ held, onOpen, fail }) {
  const [list, setList] = useState(null);
  const [isin, setIsin] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  useEffect(() => {
    let alive = true;
    api.getWatch().then((r) => alive && setList(r.watch)).catch((e) => { if (alive) { setList([]); fail(e); } });
    return () => { alive = false; };
  }, [fail]);

  const add = async (ev) => {
    ev.preventDefault();
    setBusy(true); setErr(null);
    try {
      setList((await api.addWatch(isin.trim(), name.trim())).watch);
      setIsin(''); setName('');
    } catch (e) {
      if (e instanceof api.Unauthorized) fail(e); else setErr(e.message);
    } finally { setBusy(false); }
  };
  const remove = async (x) => { try { setList((await api.removeWatch(x.isin)).watch); } catch (e) { fail(e); } };

  return (
    <div className="stack">
      <Card title="Seguir un valor" sub="Añádelo por su ISIN para ver su precio sin tenerlo en cartera">
        <form className="val-f watch-f" onSubmit={add}>
          <input type="text" value={isin} onChange={(ev) => setIsin(ev.target.value)} placeholder="ISIN (p. ej. US0378331005)" aria-label="ISIN del valor" maxLength={12} required autoCapitalize="characters" spellCheck={false} />
          <input type="text" value={name} onChange={(ev) => setName(ev.target.value)} placeholder="Nombre (opcional)" aria-label="Nombre del valor" maxLength={80} />
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Buscando…' : 'Seguir'}</button>
        </form>
        {err && <p className="note warn-t" role="alert"><Icon name="alert" size={15} /> {err}</p>}
      </Card>
      <Card title="En seguimiento" sub={list?.length ? `${list.length} ${list.length === 1 ? 'valor' : 'valores'}` : undefined}>
        {list === null ? <div className="sk" style={{ height: 120 }} /> : !list.length ? <Empty>Todavía no sigues ningún valor.</Empty> : (
          <ul className="watch-l">
            {list.map((x) => {
              const day = x.info?.dayPct, mine = held.has(x.isin);
              return (
                <li key={x.isin}>
                  <span className="watch-n">
                    {mine ? <button type="button" className="link" onClick={() => onOpen(x.isin)}>{x.name}</button> : <b>{x.name}</b>}
                    <small>{x.isin}{mine ? ' · en cartera' : ''}{x.info?.exchange ? ` · ${x.info.exchange}` : ''}</small>
                  </span>
                  <span className="watch-v">
                    <b>{x.price != null ? eur(x.price) : '—'}</b>
                    <small className={Number.isFinite(day) ? sign(day) : ''}>{Number.isFinite(day) ? pctS(day) : x.priceAt ? time(x.priceAt) : 'sin precio'}</small>
                  </span>
                  <button type="button" className="icon" aria-label={`Dejar de seguir ${x.name}`} onClick={() => remove(x)}><Icon name="trash" size={16} /></button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
