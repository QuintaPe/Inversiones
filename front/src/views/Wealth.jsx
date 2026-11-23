// Patrimonio neto: cartera y efectivo de Trade Republic, más las cuentas, bienes y deudas que
// el usuario anota a mano con su saldo en una fecha.
import { useEffect, useMemo, useState } from 'react';
import * as api from '../api.js';
import { Card, Empty, Icon } from '../components/ui.jsx';
import { Kpi } from '../components/Kpi.jsx';
import { Lines, RankBars } from '../charts.jsx';
import { KINDS, KIND_LABEL, netWorth, netWorthSeries } from '../../../shared/wealth.ts';
import { eur, pct, date, dateLong, compact, isMasked } from '../lib/format.js';

const today = () => new Date().toISOString().slice(0, 10);
const amountOf = (s) => { const n = parseFloat(String(s).replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Una cuenta: su saldo vigente, el formulario para anotar otro y sus saldos anteriores. */
function Account({ a, onSave, onRemove, onRemoveBalance }) {
  const [open, setOpen] = useState(false);
  const [sure, setSure] = useState(false);
  const [amount, setAmount] = useState('');
  const [d, setD] = useState(today());
  const last = a.balances.at(-1);
  const save = async (ev) => {
    ev.preventDefault();
    const n = amountOf(amount);
    if (n == null || !d) return;
    if (await onSave(a.id, n, d)) setAmount('');
  };
  return (
    <li className="acct">
      <div className="acct-h">
        <span className="acct-n"><b>{a.name}</b><small>{KIND_LABEL[a.kind]}{last ? ` · saldo del ${date(last.d)}` : ''}</small></span>
        <b className={`acct-v ${a.kind === 'debt' ? 'loss' : ''}`}>{last ? `${a.kind === 'debt' ? '−' : ''}${eur(last.amount)}` : '—'}</b>
        <button type="button" className="btn soft" aria-expanded={open} onClick={() => { setOpen((o) => !o); setSure(false); }}>{open ? 'Cerrar' : 'Actualizar'}</button>
      </div>
      {open && (
        <div className="acct-b">
          <form className="val-f" onSubmit={save}>
            <input type="date" value={d} max={today()} onChange={(ev) => setD(ev.target.value)} aria-label={`Fecha del saldo de ${a.name}`} required />
            <input type="text" inputMode="decimal" placeholder={a.kind === 'debt' ? 'Lo que debes €' : 'Saldo €'} value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label={`Saldo de ${a.name} en euros`} required />
            <button type="submit" className="btn pri">Anotar</button>
          </form>
          <ul className="vals">
            {[...a.balances].reverse().map((b) => (
              <li key={b.d}>
                <span>{date(b.d)}</span><b>{eur(b.amount)}</b>
                {a.balances.length > 1 && (
                  <button type="button" className="icon" aria-label={`Borrar el saldo del ${date(b.d)}`} onClick={() => onRemoveBalance(a.id, b.d)}><Icon name="trash" size={16} /></button>
                )}
              </li>
            ))}
          </ul>
          <div className="acct-x">
            {sure
              ? <><span className="mu">Se borra con todos sus saldos.</span><button type="button" className="btn bad" onClick={() => onRemove(a.id)}>Quitar {a.name}</button><button type="button" className="btn soft" onClick={() => setSure(false)}>Cancelar</button></>
              : <button type="button" className="btn soft" onClick={() => setSure(true)}><Icon name="trash" size={16} />Quitar del patrimonio</button>}
          </div>
        </div>
      )}
    </li>
  );
}

/**
 * @param portfolioValue  valor de la cartera hoy
 * @param cash            efectivo calculado del CSV ({ balance, days }) o null
 * @param hist            histórico diario de la cartera (o null)
 */
export default function Wealth({ portfolioValue, cash, hist, fail }) {
  const [accounts, setAccounts] = useState(null);
  const [f, setF] = useState({ name: '', kind: 'cash', amount: '', d: today() });
  useEffect(() => {
    let alive = true;
    api.getAccounts().then((r) => alive && setAccounts(r.accounts)).catch((e) => { if (alive) { setAccounts([]); fail(e); } });
    return () => { alive = false; };
  }, [fail]);
  const run = async (call) => {
    try { setAccounts((await call()).accounts); return true; } catch (e) { fail(e); return false; }
  };
  const add = async (ev) => {
    ev.preventDefault();
    const n = amountOf(f.amount);
    if (!f.name.trim() || n == null) return;
    if (await run(() => api.addAccount({ name: f.name, kind: f.kind, amount: n, d: f.d }))) setF({ name: '', kind: f.kind, amount: '', d: today() });
  };

  const w = useMemo(() => netWorth({ portfolio: portfolioValue, cash: cash?.balance ?? null, accounts: accounts ?? [] }), [portfolioValue, cash, accounts]);
  const series = useMemo(() => netWorthSeries({ hist, cashDays: cash?.days ?? null, accounts: accounts ?? [] }), [hist, cash, accounts]);
  if (!accounts) return <div className="sk" style={{ height: 320 }} />;
  const owned = w.parts.filter((p) => p.kind !== 'debt').sort((x, y) => y.v - x.v);
  const x = series.map((p) => Date.parse(`${p.d}T00:00:00Z`));

  return (
    <>
      <div className="kpis-row kpis-fit" style={{ '--n': w.debts > 0 ? 3 : 2 }}>
        <Kpi label="Patrimonio neto" value={eur(w.total)} sub={w.debts > 0 ? 'lo que tienes menos lo que debes' : 'inversiones, efectivo y lo que anotes aquí'} />
        <Kpi label="Tienes" value={eur(w.assets)} sub={`${owned.length} ${owned.length === 1 ? 'partida' : 'partidas'}`} />
        {w.debts > 0 && <Kpi label="Debes" value={eur(w.debts)} tone="loss" sub={`${pct((w.debts / (w.assets || 1)) * 100)} de lo que tienes`} />}
      </div>

      {series.length > 2 && (
        <section className="chart-block">
          <Lines x={x} height={240} label="Evolución del patrimonio neto, a fin de cada mes" scale={compact}
            series={[{ key: 'total', values: series.map((p) => p.total), cls: '', area: true }]}
            tip={(i) => (
              <>
                <small>{dateLong(x[i])}</small><b>{eur(series[i].total)}</b>
                <small>inversiones {eur(series[i].portfolio)} · efectivo {eur(series[i].cash)}</small>
                {(series[i].other > 0 || series[i].debt > 0) && <small>otros {eur(series[i].other)}{series[i].debt > 0 ? ` · deudas ${eur(series[i].debt)}` : ''}</small>}
              </>
            )} />
          <div className="chart-f"><span className="mu">Patrimonio neto a fin de cada mes. Lo anotado a mano vale su último saldo hasta que lo actualizas.</span></div>
        </section>
      )}

      <div className="cols">
        <Card title="De qué se compone" sub="Lo que tienes, de mayor a menor">
          {owned.length
            ? <RankBars rows={owned.map((p) => ({ key: p.key, label: p.label, w: (p.v / w.assets) * 100, right: pct((p.v / w.assets) * 100), sub: eur(p.v), other: p.kind !== 'portfolio' }))} />
            : <Empty>Todavía no hay nada que sumar.</Empty>}
        </Card>

        <Card title="Otras cuentas, bienes y deudas" sub="Lo que tienes fuera de Trade Republic: anota su saldo y actualízalo cuando cambie">
          {accounts.length > 0 && (
            <ul className="accts">
              {accounts.map((a) => (
                <Account key={a.id} a={a}
                  onSave={(id, amount, d) => run(() => api.setAccountBalance(id, amount, d))}
                  onRemove={(id) => run(() => api.removeAccount(id))}
                  onRemoveBalance={(id, d) => run(() => api.removeAccountBalance(id, d))} />
              ))}
            </ul>
          )}
          {isMasked() ? <p className="note">Muestra los importes para añadir o actualizar cuentas.</p> : (
            <form className="form acct-f" onSubmit={add}>
              <label className="wide"><span>Nombre</span><input value={f.name} maxLength={60} onChange={(ev) => setF({ ...f, name: ev.target.value })} placeholder="p. ej. Cuenta del banco, piso, hipoteca" required /></label>
              <label><span>Tipo</span>
                <select value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value })}>
                  {KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </label>
              <label><span>{f.kind === 'debt' ? 'Lo que debes (€)' : 'Saldo o valor (€)'}</span><input inputMode="decimal" value={f.amount} onChange={(ev) => setF({ ...f, amount: ev.target.value })} required /></label>
              <label><span>Fecha del saldo</span><input type="date" value={f.d} max={today()} onChange={(ev) => setF({ ...f, d: ev.target.value })} required /></label>
              <button type="submit" className="btn pri acct-add"><Icon name="plus" size={16} />Añadir</button>
            </form>
          )}
        </Card>
      </div>
      <p className="note">
        Las inversiones y el efectivo de Trade Republic salen de tu CSV y de las cotizaciones. Lo demás vale lo que anotes: la app
        no se conecta a ningún banco.
      </p>
    </>
  );
}
