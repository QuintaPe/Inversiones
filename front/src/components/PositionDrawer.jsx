import { useEffect } from 'react';
import { Avatar, Delta, Icon, Kind, Pill, PriceInput, Stat } from './ui.jsx';
import { country, classLabel, sector } from '../lib/countries.js';
import { eur, eurS, num, pct, pctS, qty, sign, date, time } from '../lib/format.js';

/** Una operación con su cuenta paso a paso y el estado de la posición después. */
function Op({ x }) {
  return (
    <li className={`op ${x.k}`}>
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

export default function PositionDrawer({ x, totalVal, onClose, onPrice, liveQuotes }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const esc = (ev) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', esc); };
  }, [onClose]);

  const { p } = x;
  const totalRet = p.open && x.has ? x.pl + x.div : null;
  return (
    <div className="scrim" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={p.name} onClick={(ev) => ev.stopPropagation()}>
        <header className="drawer-h">
          <Avatar p={p} size="lg" />
          <div className="drawer-t">
            <h2>{p.name}</h2>
            <p>{p.isin} · {p.sector ? sector(p) : classLabel(p.cls)} · {country(p.isin)}{!p.open && ' · posición cerrada'}</p>
          </div>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
        </header>

        <div className="drawer-b">
          {p.open ? (
            <>
              <div className="drawer-top">
                <div>
                  <span className="stat-l">Valor actual</span>
                  <div className="hero-v sm">{x.has ? eur(x.v) : '—'}</div>
                  {x.has ? <Delta eur={x.pl} pct={x.plp} /> : <span className="mu">Falta el precio actual</span>}
                  {x.dayPct != null && <div className="day">Última sesión <Pill n={x.dayPct} /></div>}
                </div>
                <label className="price-box">
                  <span className="stat-l">Precio actual (€)</span>
                  <PriceInput p={p} onPrice={onPrice} />
                  {p.priceSource === 'live' && p.priceInfo ? (
                    <small>
                      <span className="live-dot" aria-hidden="true" /> En vivo · {p.priceInfo.symbol} · {p.priceInfo.exchange}<br />
                      {p.priceInfo.currency !== 'EUR' && <>{num(p.priceInfo.raw)} {p.priceInfo.currency} × {p.priceInfo.rate.toFixed(4)} · </>}
                      {p.priceInfo.time ? `${date(p.priceInfo.time)} ${time(p.priceInfo.time)}` : date(p.priceAt)}
                    </small>
                  ) : (
                    <small>{p.priceAt ? `manual · ${date(p.priceAt)}` : 'sin precio'}</small>
                  )}
                </label>
              </div>
              <div className="stats three">
                <Stat label="Cantidad" value={qty(p.sh)} />
                <Stat label="Precio medio" value={eur(x.avg)} hint="precio de equilibrio" />
                <Stat label="Coste" value={eur(p.cost)} />
                <Stat label="Peso" value={x.w != null ? pct(x.w) : '—'} hint="del valor de la vista" />
                <Stat label="Dividendos netos" value={eur(x.div)} hint={x.D.length ? `${x.D.length} cobros · ${pct((x.div / p.cost) * 100)} s/coste` : 'sin cobros'} />
                <Stat label="P&L + dividendos" value={totalRet != null ? eurS(totalRet) : '—'} tone={totalRet != null ? sign(totalRet) : ''}
                  hint={totalRet != null ? pctS((totalRet / p.cost) * 100) : ''} />
              </div>

              <h3>Cómo se calcula</h3>
              <div className="calc">
                <div><span>Compras ({x.B.length})</span><b>{eur(x.bought)}</b></div>
                {x.S.length > 0 && <div><span>− Coste de lo vendido ({x.S.length} ventas)</span><b>−{eur(x.soldCost)}</b></div>}
                <div className="t"><span>= Coste de la posición</span><b>{eur(p.cost)}</b></div>
                <div><span>Precio medio = {num(p.cost)} ÷ {qty(p.sh)}</span><b>{eur(x.avg)}</b></div>
                {x.has && (
                  <>
                    <div><span>Valor = {qty(p.sh)} × {num(p.price)}</span><b>{eur(x.v)}</b></div>
                    <div className="t"><span>P&amp;L = {num(x.v)} − {num(p.cost)}</span><b className={sign(x.pl)}>{eurS(x.pl)} ({pctS(x.plp)})</b></div>
                    {totalVal > 0 && <div><span>Peso = {num(x.v)} ÷ {num(totalVal)}</span><b>{pct(x.w)}</b></div>}
                  </>
                )}
                {x.D.length > 0 && <div><span>Dividendos = bruto {num(x.divG)} − retención {num(x.divT)}</span><b>{eur(x.div)}</b></div>}
                {x.S.length > 0 && <div><span>Realizado en ventas anteriores</span><b className={sign(x.real)}>{eurS(x.real)}</b></div>}
              </div>
              {p.priceSource === 'manual' && liveQuotes && p.grp === 'ac' && (
                <p className="note">
                  Precio fijado a mano: la cotización en vivo no lo cambia.{' '}
                  <button type="button" className="link" onClick={() => onPrice(p.isin, null)}>Volver a la cotización en vivo</button>
                </p>
              )}
              {p.extra && <p className="note">{p.extra}</p>}
            </>
          ) : (
            <>
              <div className="drawer-top">
                <div>
                  <span className="stat-l">Resultado realizado</span>
                  <div className={`hero-v sm ${sign(x.real)}`}>{eurS(x.real)}</div>
                  <span className={sign(x.real)}>{x.bought ? pctS((x.real / x.bought) * 100) : ''} sobre lo invertido</span>
                </div>
              </div>
              <div className="stats three">
                <Stat label="Invertido" value={eur(x.bought)} hint={`${x.B.length} compras`} />
                <Stat label="Cobrado (neto)" value={eur(x.bought + x.real)} hint={`${x.S.length} ventas`} />
                <Stat label="Dividendos netos" value={eur(x.div)} hint={x.D.length ? `${x.D.length} cobros` : 'sin cobros'} />
              </div>
            </>
          )}

          <h3>Operaciones ({x.ops.length})</h3>
          <ul className="ops">{[...x.ops].reverse().map((e) => <Op key={e.id + e.k} x={e} />)}</ul>
        </div>
      </aside>
    </div>
  );
}
