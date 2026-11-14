import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Asset, Avatar, Empty, Flash, Icon, PriceInput, Search, Sticky, Tabs, Th, useSort } from '../components/ui.jsx';
import { Kpi, Spark } from '../components/Kpi.jsx';
import { useStored } from '../hooks.js';
import { useParam } from '../router.js';
import { classLabel, sector } from '../lib/countries.js';
import { sum } from '../../../shared/calc.js';
import Targets from './Targets.jsx';
import Risk from './Risk.jsx';
import Watch from './Watch.jsx';
import { eur, eurS, pct, pctS, qty, sign, date } from '../lib/format.js';

const GET = {
  name: (x) => x.p.name, sh: (x) => x.p.sh, avg: (x) => x.avg, price: (x) => x.p.price, cost: (x) => x.p.cost,
  v: (x) => x.v, day: (x) => x.dayPct, pl: (x) => x.pl, plp: (x) => x.plp, w: (x) => x.w, div: (x) => x.div, real: (x) => x.real,
  last: (x) => x.S.at(-1)?.d,
};

/** Título de un grupo con su valor, peso y resultado. */
const GroupHead = ({ g }) => (
  <div className="grp">
    <b>{g.label}</b>
    <span className="mu">{g.rows.length} · {pct(g.w)}</span>
    <span className="grp-v">{eur(g.v)}{g.plp != null && <small className={sign(g.pl)}>{eurS(g.pl)} · {pctS(g.plp)}</small>}</span>
  </div>
);

export default function Positions({ a, onOpen, onPrice, targets, patch, fail, income }) {
  const [tab, setTab] = useParam('ver', 'open', { open: 'abiertas', closed: 'cerradas', target: 'objetivo', watch: 'seguimiento', risk: 'analisis' });
  const held = useMemo(() => new Set(a.o.map((x) => x.p.isin)), [a.o]);
  const [q, setQ] = useParam('q', '');
  const [view, setView] = useStored('pos-view', 'list');
  const open = useSort('v');
  const closed = useSort('real');
  const match = (x) => !q || `${x.p.name} ${x.p.isin}`.toLowerCase().includes(q.trim().toLowerCase());
  const rows = useMemo(() => open.apply(a.o.filter(match), (x, k) => GET[k](x)), [a.o, q, open.sort]); // eslint-disable-line react-hooks/exhaustive-deps -- match depende de q; open.apply, de open.sort
  const crow = useMemo(() => closed.apply(a.c.filter(match), (x, k) => GET[k](x)), [a.c, q, closed.sort]); // eslint-disable-line react-hooks/exhaustive-deps -- igual que la anterior
  const s = open, c = closed;
  const [groupBy, setGroupBy] = useStored('pos-group', 'none');
  // Mini-gráficas de 30 días: solo se piden al ver las tarjetas.
  const [sparks, setSparks] = useState(null);
  const wantSparks = tab === 'open' && view === 'cards';
  useEffect(() => {
    if (!wantSparks || sparks) return undefined;
    let alive = true;
    api.getSparks().then((r) => alive && setSparks(r.sparks)).catch(() => alive && setSparks({}));
    return () => { alive = false; };
  }, [wantSparks, sparks]);
  // Grupos de la lista abierta (tipo de activo o sector), cada uno con su subtotal.
  const groups = useMemo(() => {
    if (groupBy === 'none') return [{ key: 'all', label: null, rows }];
    const keyOf = groupBy === 'cls' ? (x) => classLabel(x.p.cls) : (x) => sector(x.p);
    const m = new Map();
    for (const x of rows) { const k = keyOf(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
    return [...m].map(([k, list]) => {
      const pr = list.filter((x) => x.has);
      const v = sum(pr, (x) => x.v), cost = sum(pr, (x) => x.p.cost);
      return { key: k, label: k, rows: list, v, pl: v - cost, plp: cost ? ((v - cost) / cost) * 100 : null, w: sum(pr, (x) => x.w ?? 0) };
    }).sort((x, y) => y.v - x.v);
  }, [rows, groupBy]);
  const top3 = [...a.priced].sort((x, y) => y.v - x.v).slice(0, 3).reduce((t, x) => t + (x.w ?? 0), 0);

  return (
    <div className="stack">
      {a.priced.length > 0 && (
        <>
          <section className="hero hero-split">
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

      <Sticky><Tabs label="Estado" value={tab} onChange={setTab} items={[['open', `Abiertas · ${a.o.length}`], ['closed', `Cerradas · ${a.c.length}`], ['target', 'Cartera objetivo'], ['risk', 'Análisis'], ['watch', 'Seguimiento']]} /></Sticky>
      {tab !== 'target' && tab !== 'watch' && tab !== 'risk' && (
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Buscar por nombre o ISIN" label="Buscar posición" />
          {tab === 'open' && (
            <>
              <select aria-label="Agrupar posiciones" value={groupBy} onChange={(ev) => setGroupBy(ev.target.value)}>
                <option value="none">Sin agrupar</option>
                <option value="cls">Por tipo de activo</option>
                <option value="sector">Por sector</option>
              </select>
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

      {tab === 'risk' ? <Risk a={a} onOpen={onOpen} fail={fail} /> : tab === 'watch' ? <Watch held={held} onOpen={onOpen} fail={fail} /> : tab === 'target' ? <Targets a={a} targets={targets} patch={patch} fail={fail} onOpen={onOpen} income={income} /> : tab === 'open' && view === 'cards' ? (
        rows.length ? (
          <div className="pos-groups">
          {groups.map((g) => (
          <section key={g.key}>
          {g.label && <GroupHead g={g} />}
          <ul className="pos-cards">
            {g.rows.map((x) => (
              <li key={x.p.isin}>
                <button type="button" className="pos-card" onClick={() => onOpen(x.p.isin)}>
                  <span className="pos-card-h">
                    <Avatar p={x.p} />
                    <span className="asset-t"><b className="name">{x.p.name}</b><small>{qty(x.p.sh)} uds. a {eur(x.avg)}</small></span>
                  </span>
                  <span className="pos-card-m">
                    <Flash value={x.v} className="pos-card-v">{x.has ? eur(x.v) : '—'}</Flash>
                    {sparks?.[x.p.isin] && <Spark values={sparks[x.p.isin]} tone={sign(sparks[x.p.isin].at(-1) - sparks[x.p.isin][0])} />}
                  </span>
                  <span className="pos-card-r">
                    {x.has ? <><span className={sign(x.pl)}>{eurS(x.pl)}</span><span className={`pct ${sign(x.plp)}`}>{pctS(x.plp)}</span></> : <span className="mu">sin precio</span>}
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
          </section>
          ))}
          </div>
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
            {groups.map((g) => (
            <tbody key={g.key}>
              {g.label && <tr className="grp-h static"><td colSpan={6}><GroupHead g={g} /></td></tr>}
              {g.rows.map((x) => (
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
                    <small className={`only-s ${x.has ? sign(x.plp) : ''}`}>{x.has ? pctS(x.plp) : 'sin precio'}</small>
                  </td>
                  <td className="hide-s">
                    {x.has ? <span className={sign(x.pl)}>{eurS(x.pl)}</span> : <span className="mu">—</span>}
                    {x.has && <small className={sign(x.plp)}>{pctS(x.plp)}</small>}
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
            ))}
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
                      {pr.length > 0 && <small className={sign(pl)}>{pctS((pl / cost) * 100)}</small>}
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
          <table className="tbl tbl-pos">
            <thead>
              <tr>
                <Th id="name" sort={c.sort} onSort={c.onSort} className="l">Activo</Th>
                <Th id="last" sort={c.sort} onSort={c.onSort} className="hide-s">Última venta</Th>
                <th className="hide-s">Invertido</th>
                <Th id="real" sort={c.sort} onSort={c.onSort}>Realizado</Th>
                <Th id="div" sort={c.sort} onSort={c.onSort} className="hide-m">Dividendos</Th>
              </tr>
            </thead>
            <tbody>
              {crow.map((x) => (
                <tr key={x.p.isin} onClick={() => onOpen(x.p.isin)} tabIndex={0}
                  onKeyDown={(ev) => ev.key === 'Enter' && onOpen(x.p.isin)}>
                  <td className="l"><Asset p={x.p}>{x.B.length} {x.B.length === 1 ? 'compra' : 'compras'} · {x.S.length} {x.S.length === 1 ? 'venta' : 'ventas'}</Asset></td>
                  <td className="hide-s">{date(x.S.at(-1)?.d)}</td>
                  <td className="hide-s">{eur(x.bought)}<small>cobrado {eur(sum(x.S, (k) => k.net))}</small></td>
                  <td>
                    <span className={sign(x.real)}>{eurS(x.real)}</span>
                    <small className={x.bought ? sign(x.real) : 'mu'}>{x.bought ? pctS((x.real / x.bought) * 100) : '—'}</small>
                  </td>
                  <td className="hide-m">{x.div ? eur(x.div) : <span className="mu">—</span>}</td>
                </tr>
              ))}
            </tbody>
            {crow.length > 1 && (
              <tfoot>
                <tr>
                  <td className="l">Total ({crow.length})</td>
                  <td className="hide-s" />
                  <td className="hide-s">{eur(sum(crow, (x) => x.bought))}</td>
                  <td className={sign(sum(crow, (x) => x.real))}>{eurS(sum(crow, (x) => x.real))}</td>
                  <td className="hide-m">{eur(sum(crow, (x) => x.div))}</td>
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
