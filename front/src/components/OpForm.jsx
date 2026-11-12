import { useEffect, useState } from 'react';
import { Icon, Seg } from './ui.jsx';
import { eur } from '../lib/format.js';

const TYPES = [['BUY', 'Compra'], ['SELL', 'Venta'], ['DIVIDEND', 'Dividendo']];
const today = () => new Date().toISOString().slice(0, 10);
const txt = (n) => (n ? String(+Number(n).toFixed(6)) : '');

/**
 * Alta o edición de una operación a mano.
 * initial: { tid?, type, isin, name, asset_class, date, shares, price, fee, tax, amount }
 */
export default function OpForm({ initial = {}, positions, onSubmit, onClose }) {
  const [f, setF] = useState({
    type: initial.type ?? 'BUY', name: initial.name ?? '', isin: initial.isin ?? '', asset_class: initial.asset_class ?? 'STOCK',
    date: initial.date ?? today(), shares: txt(initial.shares), price: txt(initial.price),
    fee: initial.fee != null ? txt(initial.fee) || '0' : '1', tax: txt(initial.tax), amount: txt(initial.amount),
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = (k) => (ev) => setF((s) => ({ ...s, [k]: ev.target.value }));
  const div = f.type === 'DIVIDEND';
  const locked = !!initial.isin; // desde la ficha de un activo, el activo ya está elegido

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    const esc = (ev) => ev.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => { document.body.style.overflow = ''; window.removeEventListener('keydown', esc); };
  }, [onClose]);

  // Al escribir el nombre de un activo que ya tienes se rellena su ISIN.
  const pickName = (ev) => {
    const name = ev.target.value;
    const p = positions.find((x) => x.name === name);
    setF((s) => ({ ...s, name, ...(p ? { isin: p.isin, asset_class: p.cls } : {}) }));
  };
  const n = (v) => parseFloat(String(v).replace(',', '.')) || 0;
  const total = div ? n(f.amount) - n(f.tax) : f.type === 'BUY' ? n(f.shares) * n(f.price) + n(f.fee) + n(f.tax) : n(f.shares) * n(f.price) - n(f.fee);

  const submit = async (ev) => {
    ev.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ ...f, shares: n(f.shares), price: n(f.price), fee: n(f.fee), tax: n(f.tax), amount: n(f.amount) }, initial.tid);
      onClose();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  return (
    <div className="scrim top" onClick={onClose}>
      <form className="sheet" role="dialog" aria-modal="true" aria-label={initial.tid ? 'Editar operación' : 'Añadir operación'}
        onClick={(ev) => ev.stopPropagation()} onSubmit={submit}>
        <header className="sheet-h">
          <h2>{initial.tid ? 'Editar operación' : 'Añadir operación'}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="close" /></button>
        </header>
        <Seg label="Tipo de operación" options={TYPES} value={f.type} onChange={(type) => setF((s) => ({ ...s, type }))} />
        <div className="form">
          <label className="wide"><span>Activo</span>
            <input list="op-assets" value={f.name} onChange={pickName} placeholder="Nombre" required maxLength={80} disabled={locked} autoFocus={!locked} /></label>
          <datalist id="op-assets">{positions.map((p) => <option key={p.isin} value={p.name} />)}</datalist>
          <label><span>ISIN o identificador</span>
            <input value={f.isin} onChange={set('isin')} placeholder="US0378331005" required maxLength={20} disabled={locked} /></label>
          <label><span>Fecha</span>
            <input type="date" value={f.date} max={today()} onChange={set('date')} required /></label>
          {div ? (
            <>
              <label><span>Importe bruto (€)</span><input inputMode="decimal" value={f.amount} onChange={set('amount')} required autoFocus={locked} /></label>
              <label><span>Retención (€)</span><input inputMode="decimal" value={f.tax} onChange={set('tax')} placeholder="0" /></label>
              <label><span>Acciones (opcional)</span><input inputMode="decimal" value={f.shares} onChange={set('shares')} /></label>
            </>
          ) : (
            <>
              <label><span>Cantidad</span><input inputMode="decimal" value={f.shares} onChange={set('shares')} required autoFocus={locked} /></label>
              <label><span>Precio por unidad (€)</span><input inputMode="decimal" value={f.price} onChange={set('price')} required /></label>
              <label><span>Comisión (€)</span><input inputMode="decimal" value={f.fee} onChange={set('fee')} /></label>
              {f.type === 'BUY' && <label><span>Impuesto de compra (€)</span><input inputMode="decimal" value={f.tax} onChange={set('tax')} placeholder="0" /></label>}
            </>
          )}
        </div>
        <p className="sheet-t">
          {div ? 'Neto cobrado' : f.type === 'BUY' ? 'Coste total' : 'Cobro neto'}
          <b>{eur(total)}</b>
        </p>
        {err && <p className="note loss" role="alert">{err}</p>}
        <div className="sheet-a">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="btn pri" disabled={busy}>{busy ? 'Guardando…' : initial.tid ? 'Guardar cambios' : 'Añadir'}</button>
        </div>
      </form>
    </div>
  );
}
