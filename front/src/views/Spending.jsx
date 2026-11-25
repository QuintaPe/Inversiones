// Gastos mes a mes: en qué categorías y comercios se va el dinero, frente a lo habitual, y cada
// pago del mes agrupado por día. La categoría de un comercio se puede cambiar y vale para todos
// sus pagos. Gasto = pagos con tarjeta y lo que sale por transferencia o recibo; las devoluciones
// (importes positivos) restan de su categoría.
import { useMemo, useState } from 'react';
import * as api from '../api.js';
import { Card, Empty, Icon, Search } from '../components/ui.jsx';
import { useParam } from '../router.js';
import { CATS, CAT, categoryOf, prettyName, recurring } from '../lib/categories.js';
import { eur, eurS, pct, dayShort } from '../lib/format.js';

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const monthName = (ym) => `${MONTHS[+ym.slice(5, 7) - 1]} de ${ym.slice(0, 4)}`;
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const isPay = (m) => m[1] === 'card' || m[1] === 'withdrawal';
const swatch = (k) => ({ '--h': CAT[k]?.hue ?? 230 });

/** Selector de categoría de un comercio, con aspecto de etiqueta. */
function CatPick({ merchant, value, auto, onPick }) {
  return (
    <label className="cat-pick" style={swatch(value)}>
      <i aria-hidden="true" />{CAT[value].label}
      {/* El select va encima, invisible: se ve la etiqueta y al pulsarla se abre la lista. */}
      <select value={value} aria-label={`Categoría de ${prettyName(merchant)}`} onChange={(ev) => onPick(merchant, ev.target.value === auto ? null : ev.target.value)}>
        {CATS.map(([k, label]) => <option key={k} value={k}>{label}{k === auto ? ' (automática)' : ''}</option>)}
      </select>
    </label>
  );
}

/** Campo de un tope: se guarda al salir o con Intro, solo si ha cambiado. */
function BudgetInput({ k, label, value, onSave }) {
  const shown = value ? String(value).replace('.', ',') : '';
  return (
    <label><span>{label}</span>
      <input key={shown} inputMode="decimal" defaultValue={shown} placeholder="Sin tope" aria-label={`Tope de ${label}`}
        onKeyDown={(ev) => { if (ev.key === 'Enter') ev.currentTarget.blur(); }}
        onBlur={(ev) => { const v = ev.target.value.trim(); if (v !== shown) onSave(k, v); }} />
    </label>
  );
}

export default function Spending({ moves, cats, onCats, budgets = {}, onBudgets, fail }) {
  const [editing, setEditing] = useState(false);
  const pays = useMemo(() => moves.filter(isPay), [moves]);
  const months = useMemo(() => [...new Set(pays.map((m) => m[0].slice(0, 7)))].sort(), [pays]);
  const [sel, setSel] = useParam('gasto', null);
  const month = months.includes(sel) ? sel : months.at(-1);
  const [cat, setCat] = useState(null); // filtro de la lista por categoría
  const [q, setQ] = useState('');

  // Gasto por mes y categoría (positivo = gasto), para el mes elegido y la media de los 12 anteriores.
  const byMonth = useMemo(() => {
    const out = {};
    for (const m of pays) {
      const k = categoryOf(m, cats);
      const o = (out[m[0].slice(0, 7)] ??= { total: 0, cats: {} });
      o.total -= m[2];
      o.cats[k] = (o.cats[k] ?? 0) - m[2];
    }
    return out;
  }, [pays, cats]);

  if (!month) return null;
  const i = months.indexOf(month);
  const prev = months.slice(Math.max(0, i - 12), i);
  const avgOf = (k) => (prev.length ? prev.reduce((s, m) => s + (k ? byMonth[m]?.cats[k] ?? 0 : byMonth[m]?.total ?? 0), 0) / prev.length : null);
  const cur = byMonth[month] ?? { total: 0, cats: {} };
  const avg = avgOf(null);
  const rows = pays.filter((m) => m[0].startsWith(month));
  const spendRows = rows.filter((m) => m[2] < 0);
  const catRows = Object.entries(cur.cats).filter(([, v]) => v > 0.005).sort((a, b) => b[1] - a[1]);
  const maxCat = Math.max(...catRows.map(([, v]) => v), 1);

  // Dónde más gastas este mes.
  const merchants = {};
  for (const m of spendRows) {
    const name = prettyName(m[3]) || CAT[categoryOf(m, cats)].label;
    const o = (merchants[name] ??= { name, n: 0, v: 0, k: categoryOf(m, cats) });
    o.n++; o.v -= m[2];
  }
  const top = Object.values(merchants).sort((a, b) => b.v - a.v).slice(0, 8);

  // Pagos del mes, con filtros, por día (lo más reciente arriba).
  const s = q.trim().toLowerCase();
  const list = rows.filter((m) => (!cat || categoryOf(m, cats) === cat) && (!s || (m[3] ?? '').toLowerCase().includes(s))).reverse();
  const days = [];
  for (const m of list) {
    if (days.at(-1)?.d !== m[0]) days.push({ d: m[0], items: [], total: 0 });
    days.at(-1).items.push(m);
    days.at(-1).total += m[2];
  }

  // Datos subidos antes de guardar el comercio: sin nombres ni MCC no hay categorías.
  const stale = !pays.some((m) => m[3] || m[4]);
  const subs = recurring(pays, moves.at(-1)[0]);
  const subsYear = subs.reduce((s, x) => s + x.yearly, 0);

  const pick = async (merchant, category) => {
    try { onCats((await api.setCategory(merchant, category)).cats); } catch (err) { fail(err, 'No se guardó la categoría: '); }
  };
  const saveBudget = async (k, amount) => {
    try { onBudgets((await api.setBudget(k, amount)).budgets); } catch (err) { fail(err, 'No se guardó el tope: '); }
  };
  // Tope de todo el mes: cuánto queda (o cuánto te has pasado) y por dónde deberías ir a estas alturas.
  const cap$ = budgets.total > 0 ? budgets.total : null;
  const today = moves.at(-1)[0];
  const [yy, mm] = month.split('-').map(Number);
  const daysIn = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const pace = month === today.slice(0, 7) ? Number(today.slice(8, 10)) / daysIn : 1;
  const go = (d) => { setSel(months[i + d]); setCat(null); };
  const diff = avg != null ? cur.total - avg : null;

  return (
    <>
      <div className="sect-h">
        <h2 className="month-t">{cap(monthName(month))}</h2>
        <div className="month-nav">
          <button type="button" className="icon-btn sm" onClick={() => go(-1)} disabled={i === 0} aria-label="Mes anterior"><Icon name="back" size={16} /></button>
          <button type="button" className="icon-btn sm flip" onClick={() => go(1)} disabled={i === months.length - 1} aria-label="Mes siguiente"><Icon name="back" size={16} /></button>
        </div>
      </div>

      {stale && (
        <p className="callout" role="status">
          <Icon name="upload" size={16} />
          <span>Tus pagos se subieron antes de que la app guardara el comercio. Vuelve a subir el CSV de Trade Republic
            (no se duplica nada) para ver dónde gastas y en qué categorías.</span>
        </p>
      )}

      <div className="cols spend">
        <Card title={eur(cur.total)} sub={diff == null ? `${spendRows.length} pagos` : `${spendRows.length} pagos · ${diff > 0 ? `${eur(diff)} más` : `${eur(-diff)} menos`} que tu media (${eur(avg)})`} className="spend-sum">
          {cap$ && (
            <div className={`bud ${cur.total > cap$ ? 'over' : ''}`}>
              <div className="bud-b" role="img" aria-label={`Gastado ${Math.round((cur.total / cap$) * 100)} % del tope del mes`}>
                <em style={{ width: `${Math.min(100, (cur.total / cap$) * 100)}%` }} />
                {pace < 1 && <u style={{ left: `${pace * 100}%` }} title="Hoy" />}
              </div>
              <p>
                {cur.total > cap$ ? <>Te has pasado <b>{eur(cur.total - cap$)}</b> de tu tope de {eur(cap$)}</>
                  : <>Te quedan <b>{eur(cap$ - cur.total)}</b> de tu tope de {eur(cap$)}</>}
                {pace < 1 && cur.total <= cap$ && (cur.total > cap$ * pace ? ' · vas por encima del ritmo' : ' · vas dentro del ritmo')}
              </p>
            </div>
          )}
          {!catRows.length ? <Empty>Sin gastos este mes.</Empty> : (
            <ul className="cat-l">
              {catRows.map(([k, v]) => {
                const a = avgOf(k);
                return (
                  <li key={k}>
                    <button type="button" className={cat === k ? 'on' : ''} aria-pressed={cat === k} onClick={() => setCat(cat === k ? null : k)} style={swatch(k)}>
                      <span className="cat-n"><i aria-hidden="true" />{CAT[k].label}</span>
                      <span className="cat-b" aria-hidden="true"><em style={{ width: `${(v / maxCat) * 100}%` }} />{a > 0 && <u style={{ left: `${Math.min(100, (a / maxCat) * 100)}%` }} title={`Media: ${eur(a)}`} />}</span>
                      <span className="cat-v"><b className={budgets[k] > 0 && v > budgets[k] ? 'loss' : ''}>{eur(v)}</b>
                        <small>{budgets[k] > 0 ? `tope ${eur(budgets[k])}` : pct((v / cur.total) * 100)}{a > 0 ? ` · media ${eur(a)}` : ''}</small></span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="cat-hint">Pulsa una categoría para ver solo sus pagos. La raya marca tu media de los últimos meses.</p>
          <button type="button" className="fold" aria-expanded={editing} onClick={() => setEditing((v) => !v)}>
            {editing ? 'Ocultar los topes' : Object.keys(budgets).length ? 'Cambiar los topes de gasto' : 'Poner topes de gasto al mes'}
          </button>
          {editing && (
            <div className="form bud-f">
              <BudgetInput k="total" label="Todo el mes (€)" value={budgets.total} onSave={saveBudget} />
              {CATS.filter(([k]) => budgets[k] > 0 || prev.concat(month).some((m) => byMonth[m]?.cats[k] > 0)).map(([k, label]) => (
                <BudgetInput key={k} k={k} label={`${label} (€)`} value={budgets[k]} onSave={saveBudget} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Dónde más gastas" sub={cap(monthName(month))}>
          {!top.length ? <Empty>Sin gastos este mes.</Empty> : (
            <ul className="top-m">
              {top.map((m) => (
                <li key={m.name} style={swatch(m.k)}>
                  <span className="top-i" aria-hidden="true">{m.name[0]?.toUpperCase()}</span>
                  <span className="top-n"><b>{m.name}</b><small>{m.n} {m.n === 1 ? 'pago' : 'pagos'} · {CAT[m.k].label}</small></span>
                  <b className="top-v">{eur(m.v)}</b>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {subs.length > 0 && (
        <Card title="Pagos recurrentes" sub={`${subs.length} ${subs.length === 1 ? 'cargo fijo' : 'cargos fijos'} cada mes · ${eur(subsYear)} al año`}>
          <ul className="top-m rec">
            {subs.map((x) => {
              const k = categoryOf(['', 'card', -x.amount, x.name, pays.find((m) => m[3] === x.name)?.[4] ?? ''], cats);
              return (
                <li key={x.name} style={swatch(k)}>
                  <span className="top-i" aria-hidden="true">{x.name[0]?.toUpperCase()}</span>
                  <span className="top-n"><b>{prettyName(x.name)}</b><small>día {x.day} de cada mes · {x.months} meses seguidos · {CAT[k].label}</small></span>
                  <span className="rec-v"><b>{eur(x.amount)}</b><small>{eur(x.yearly)} al año</small></span>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <section className="card pays">
        <header className="card-h">
          <div><h2>Pagos de {monthName(month)}</h2><p>{list.length} {list.length === 1 ? 'movimiento' : 'movimientos'}{cat ? ` en ${CAT[cat].label}` : ''} · cambia la categoría de un comercio y se aplica a todos sus pagos</p></div>
        </header>
        <div className="toolbar">
          <Search value={q} onChange={setQ} placeholder="Buscar comercio" label="Buscar comercio" />
          {cat && <button type="button" className="btn" onClick={() => setCat(null)}><Icon name="close" size={14} />{CAT[cat].label}</button>}
        </div>
        {!days.length && <Empty>No hay pagos que coincidan.</Empty>}
        {days.map((d) => (
          <div key={d.d} className="pay-d">
            <h3><span>{dayShort(d.d)}</span><span>{eurS(d.total)}</span></h3>
            <ul>
              {d.items.map((m, j) => {
                const k = categoryOf(m, cats);
                const auto = categoryOf(m, {});
                return (
                  <li key={`${m[0]}-${j}`}>
                    <span className="top-i" style={swatch(k)} aria-hidden="true">{(m[3] || CAT[k].label)[0].toUpperCase()}</span>
                    <span className="pay-n"><b>{prettyName(m[3]) || (m[1] === 'withdrawal' ? 'Transferencia' : CAT[k].label)}</b>
                      {m[3] ? <CatPick merchant={m[3]} value={k} auto={auto} onPick={pick} /> : <small>{CAT[k].label}</small>}</span>
                    <b className={`pay-v ${m[2] > 0 ? 'gain' : ''}`}>{eurS(m[2])}</b>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}
