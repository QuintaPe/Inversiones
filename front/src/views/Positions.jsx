import { useMemo, useState } from 'react';
import { Asset, Avatar, Empty, Flash, Icon, Pill, PriceInput, Search, Th, useSort } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { useStored } from '../hooks.js';
import { sum } from '../lib/calc.js';
import Targets from './Targets.jsx';
import { eur, eurS, pct, pctS, qty, sign, date } from '../lib/format.js';

const GET = {
  name: (x) => x.p.name, sh: (x) => x.p.sh, avg: (x) => x.avg, price: (x) => x.p.price, cost: (x) => x.p.cost,
  v: (x) => x.v, day: (x) => x.dayPct, pl: (x) => x.pl, plp: (x) => x.plp, w: (x) => x.w, div: (x) => x.div, real: (x) => x.real,
  last: (x) => x.S.at(-1)?.d,
};

export default function Positions({ a, onOpen, onPrice, targets, patch, fail }) {
  const [tab, setTab] = useState('open');
  const [q, setQ] = useState('');
  const [view, setView] = useStored('pos-view', 'list');
  const open = useSort('v');
  const closed = useSort('real');
  const match = (x) => !q || `${x.p.name} ${x.p.isin}`.toLowerCase().includes(q.trim().toLowerCase());
  const rows = useMemo(() => open.apply(a.o.filter(match), (x, k) => GET[k](x)), [a.o, q, open.sort]);
  const crow = useMemo(() => closed.apply(a.c.filter(match), (x, k) => GET[k](x)), [a.c, q, closed.sort]);
  const s = open, c = closed;
  const top3 = [...a.priced].sort((x, y) => y.v - x.v).slice(0, 3).reduce((t, x) => t + (x.w ?? 0), 0);

  return (
    <div className="stack">
      {a.priced.length > 0 && (
        <>
          <section className="hero">
            <span className="eyebrow">Valor de tus posiciones</span>
            <Flash value={a.val} as="div" className="hero-v">{eur(a.val)}</Flash>
            <div className="hero-d">
              <span className={`chg ${sign(a.pl)}`}><span aria-hidden="true">{a.pl >= 0 ? '▲' : '▼'}</span> {eurS(a.pl)} · {pctS(a.plp)} <em>desde la compra</em></span>
              {a.day != null && <span className={`chg ${sign(a.day)}`}><span aria-hidden="true">{a.day >= 0 ? '▲' : '▼'}</span> {eurS(a.day)} · {pctS(a.dayPct)} <em>hoy</em></span>}
            </div>
          </section>

          <div className="kpis-row">
            <Kpi label="Invertido" value={eur(a.costPriced)} sub={`en ${a.priced.length} ${a.priced.length === 1 ? 'posición' : 'posiciones'}`} />
            <Kpi label="Realizado en ventas" value={eurS(a.real)} tone={sign(a.real)} sub="desde el inicio" />
            <Kpi label="Dividendos cobrados" value={eur(a.divN)} sub="netos, desde el inicio" />
            <Kpi label="Concentración" value={pct(top3)} sub="pesan tus 3 mayores posiciones" />
          </div>
        </>
      )}

      <div className="utabs" role="tablist" aria-label="Estado">
        {[['open', `Abiertas · ${a.o.length}`], ['closed', `Cerradas · ${a.c.length}`], ['target', 'Cartera objetivo']].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab !== 'target' && (
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Buscar por nombre o ISIN" label="Buscar posición" />
          {tab === 'open' && (
            <>
              {view === 'cards' && (
                <select aria-label="Ordenar por" value={s.sort.key} onChange={(ev) => s.onSort(ev.target.value)}>
                  {[['v', 'Valor'], ['plp', 'Rentabilidad'], ['pl', 'Resultado en €'], ['day', 'Hoy'], ['name', 'Nombre']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              )}
              <span className="view-t" role="group" aria-label="Vista">
                <button type="button" className="icon-btn sm" aria-pressed={view === 'list'} onClick={() => setView('list')} aria-label="Ver como lista" title="Lista"><Icon name="list" size={16} /></button>
                <button type="button" className="icon-btn sm" aria-pressed={view === 'cards'} onClick={() => setView('cards')} aria-label="Ver como tarjetas" title="Tarjetas"><Icon name="grid" size={16} /></button>
              </span>
            </>
          )}
        </div>
      )}

      {tab === 'target' ? <Targets a={a} targets={targets} patch={patch} fail={fail} onOpen={onOpen} /> : tab === 'open' && view === 'cards' ? (
        rows.length ? (
          <ul className="pos-cards">
            {rows.map((x) => (
              <li key={x.p.isin}>
                <button type="button" className="pos-card" onClick={() => onOpen(x.p.isin)}>
                  <span className="pos-card-h">
                    <Avatar p={x.p} />
                    <span className="asset-t"><b className="name">{x.p.name}</b><small>{qty(x.p.sh)} uds. a {eur(x.avg)}</small></span>
                  </span>
                  <Flash value={x.v} className="pos-card-v">{x.has ? eur(x.v) : '—'}</Flash>
                  <span className="pos-card-r">
                    {x.has ? <><span className={sign(x.pl)}>{eurS(x.pl)}</span><Pill n={x.plp} plain /></> : <span className="mu">sin precio</span>}
                  </span>
                  <span className="pos-card-f">
                    <span className="wt-b"><i style={{ width: `${Math.min(100, (x.w ?? 0) * 2)}%` }} /></span>
                    <small>{x.w != null ? `${pct(x.w)} de la cartera` : ''}</small>
                    {x.dayPct != null && <small className={sign(x.dayPct)}>{pctS(x.dayPct)} hoy</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : <div className="card"><Empty>{q ? 'Ninguna posición coincide con la búsqueda.' : 'No hay posiciones abiertas en esta vista.'}</Empty></div>
      ) : tab === 'open' ? (
        <div className="card table-card">
          <table className="tbl tbl-pos">
            <thead>
              <tr>
                <Th id="name" sort={s.sort} onSort={s.onSort} className="l">Activo</Th>
                <Th id="day" sort={s.sort} onSort={s.onSort} className="hide-s">Precio · día</Th>
                <Th id="v" sort={s.sort} onSort={s.onSort}>Valor</Th>
                <Th id="plp" sort={s.sort} onSort={s.onSort} className="hide-s">Resultado</Th>
                <Th id="w" sort={s.sort} onSort={s.onSort} className="hide-m">Peso</Th>
                <Th id="div" sort={s.sort} onSort={s.onSort} className="hide-m hide-l">Dividendos</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.p.isin} onClick={() => onOpen(x.p.isin)} tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && ev.target === ev.currentTarget && onOpen(x.p.isin)}>
                  <td className="l">
                    <Asset p={x.p}>{qty(x.p.sh)} uds. a {eur(x.avg)}</Asset>
                  </td>
                  <td className="hide-s">
                    {x.p.priceSource === 'live'
                      ? <span className="px-t"><i className="live-dot" aria-hidden="true" />{eur(x.p.price)}</span>
                      : <PriceInput p={x.p} onPrice={onPrice} />}
                    {x.dayPct != null && <small className={sign(x.dayPct)}>{pctS(x.dayPct)} hoy</small>}
                  </td>
                  <td>
                    {x.has ? <Flash value={x.v}>{eur(x.v)}</Flash> : <span className="mu">—</span>}
                    <small className="hide-s">coste {eur(x.p.cost)}</small>
                    <small className="only-s">{x.has ? <Pill n={x.plp} plain /> : 'sin precio'}</small>
                  </td>
                  <td className="hide-s">
                    {x.has ? <span className={sign(x.pl)}>{eurS(x.pl)}</span> : <span className="mu">—</span>}
                    {x.has && <small><Pill n={x.plp} plain /></small>}
                  </td>
                  <td className="hide-m">
                    {x.w != null
                      ? <span className="wt"><span className="wt-b"><i style={{ width: `${Math.min(100, x.w * 4)}%` }} /></span>{pct(x.w)}</span>
                      : <span className="mu">—</span>}
                  </td>
                  <td className="hide-m hide-l">{x.div ? eur(x.div) : <span className="mu">—</span>}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 1 && (() => {
              const pr = rows.filter((x) => x.has), pl = sum(pr, (x) => x.pl), cost = sum(pr, (x) => x.p.cost);
              return (
                <tfoot>
                  <tr>
                    <td className="l">Total ({rows.length})</td>
                    <td className="hide-s" />
                    <td>{eur(sum(rows, (x) => x.v ?? 0))}<small className="hide-s">coste {eur(sum(rows, (x) => x.p.cost))}</small></td>
                    <td className="hide-s">
                      <span className={sign(pl)}>{pr.length ? eurS(pl) : '—'}</span>
                      {pr.length > 0 && <small><Pill n={(pl / cost) * 100} plain /></small>}
                    </td>
                    <td className="hide-m" />
                    <td className="hide-m hide-l">{eur(sum(rows, (x) => x.div))}</td>
                  </tr>
                </tfoot>
              );
            })()}
          </table>
          {!rows.length && <Empty>{q ? 'Ninguna posición coincide con la búsqueda.' : 'No hay posiciones abiertas en esta vista.'}</Empty>}
        </div>
      ) : (
        <div className="card table-card">
          <table className="tbl">
            <thead>
              <tr>
                <Th id="name" sort={c.sort} onSort={c.onSort} className="l">Activo</Th>
                <Th id="last" sort={c.sort} onSort={c.onSort} className="hide-s">Última venta</Th>
                <th className="hide-m">Compras</th>
                <th className="hide-m">Ventas (neto)</th>
                <Th id="real" sort={c.sort} onSort={c.onSort}>Realizado</Th>
                <th className="hide-s">Rentab.</th>
                <Th id="div" sort={c.sort} onSort={c.onSort} className="hide-s">Dividendos</Th>
              </tr>
            </thead>
            <tbody>
              {crow.map((x) => (
                <tr key={x.p.isin} onClick={() => onOpen(x.p.isin)} tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && onOpen(x.p.isin)}>
                  <td className="l"><Asset p={x.p}>{x.p.isin}</Asset></td>
                  <td className="hide-s">{date(x.S.at(-1)?.d)}</td>
                  <td className="hide-m">{eur(x.bought)}</td>
                  <td className="hide-m">{eur(sum(x.S, (k) => k.net))}</td>
                  <td className={sign(x.real)}>{eurS(x.real)}</td>
                  <td className="hide-s"><Pill n={x.bought ? (x.real / x.bought) * 100 : null} plain /></td>
                  <td className="hide-s">{x.div ? eur(x.div) : <span className="mu">—</span>}</td>
                </tr>
              ))}
            </tbody>
            {crow.length > 1 && (
              <tfoot>
                <tr>
                  <td className="l">Total ({crow.length})</td>
                  <td className="hide-s" /><td className="hide-m">{eur(sum(crow, (x) => x.bought))}</td>
                  <td className="hide-m">{eur(sum(crow, (x) => sum(x.S, (k) => k.net)))}</td>
                  <td className={sign(sum(crow, (x) => x.real))}>{eurS(sum(crow, (x) => x.real))}</td>
                  <td className="hide-s" />
                  <td className="hide-s">{eur(sum(crow, (x) => x.div))}</td>
                </tr>
              </tfoot>
            )}
          </table>
          {!crow.length && <Empty>No hay posiciones cerradas en esta vista.</Empty>}
        </div>
      )}
    </div>
  );
}
