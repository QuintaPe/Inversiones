import { useMemo, useState } from 'react';
import { Asset, Empty, Flash, Pill, PriceInput, Search, Seg, Th, useSort } from '../components/ui.jsx';
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
  const open = useSort('v');
  const closed = useSort('real');
  const match = (x) => !q || `${x.p.name} ${x.p.isin}`.toLowerCase().includes(q.trim().toLowerCase());
  const rows = useMemo(() => open.apply(a.o.filter(match), (x, k) => GET[k](x)), [a.o, q, open.sort]);
  const crow = useMemo(() => closed.apply(a.c.filter(match), (x, k) => GET[k](x)), [a.c, q, closed.sort]);
  const s = open, c = closed;

  return (
    <div className="stack">
      <div className="toolbar">
        <Seg label="Estado" value={tab} onChange={setTab}
          options={[['open', `Abiertas (${a.o.length})`], ['closed', `Cerradas (${a.c.length})`], ['target', 'Objetivo']]} />
        <Search value={q} onChange={setQ} placeholder="Buscar por nombre o ISIN" label="Buscar posición" />
      </div>

      {tab === 'target' ? <Targets a={a} targets={targets} patch={patch} fail={fail} onOpen={onOpen} /> : tab === 'open' ? (
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
                    <PriceInput p={x.p} onPrice={onPrice} />
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
