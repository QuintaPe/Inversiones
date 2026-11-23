// Índice de referencia propio: qué índices mezclar y con qué peso (Resumen → detalle de rentabilidad).
import { useState } from 'react';
import { BENCHMARKS } from '../../../shared/benchmarks.ts';
import { pct } from '../lib/format.js';

const n = (v) => parseFloat(String(v).replace(',', '.')) || 0;

/**
 * @param value   ajuste guardado ({ parts: [{ key, w }] }) o undefined
 * @param onSave  (ajuste | null) => void
 */
export default function BenchEditor({ value, onSave }) {
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(() => Object.fromEntries((value?.parts ?? []).map((p) => [p.key, String(p.w).replace('.', ',')])));
  const total = BENCHMARKS.reduce((t, b) => t + n(w[b.key]), 0);
  const ok = Math.abs(total - 100) < 0.05;
  const save = (ev) => {
    ev.preventDefault();
    if (!ok) return;
    onSave({ parts: BENCHMARKS.filter((b) => n(w[b.key]) > 0).map((b) => ({ key: b.key, w: n(w[b.key]) })) });
    setOpen(false);
  };
  return (
    <div className="bench-e">
      <button type="button" className="fold" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Cerrar' : value ? 'Cambiar tu índice de referencia' : 'Elegir tu índice de referencia'}
      </button>
      {open && (
        <form onSubmit={save}>
          <p className="note">Reparte 100 % entre los índices con los que quieres compararte: uno solo o una mezcla (por ejemplo, 80 % MSCI World y 20 % bonos).</p>
          <div className="form bench-f">
            {BENCHMARKS.map((b) => (
              <label key={b.key}><span>{b.name} (%)</span>
                <input inputMode="decimal" placeholder="0" value={w[b.key] ?? ''} onChange={(ev) => setW({ ...w, [b.key]: ev.target.value })} />
              </label>
            ))}
          </div>
          <div className="bench-a">
            <span className={ok ? 'mu' : 'loss'} role="status">Suma {pct(total)}{ok ? '' : ': tiene que ser 100 %'}</span>
            {value && <button type="button" className="btn soft" onClick={() => { onSave(null); setW({}); setOpen(false); }}>Quitar mi índice</button>}
            <button type="submit" className="btn pri" disabled={!ok}>Guardar</button>
          </div>
        </form>
      )}
    </div>
  );
}
