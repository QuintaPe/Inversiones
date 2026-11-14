// Lo que el usuario cambia a mano: operaciones, precios, notas y el borrado de todo.
import { useCallback } from 'react';
import * as api from '../api.js';

/**
 * @param confirm        (pregunta) => Promise<boolean>
 * @param refreshQuotes  vuelve a cotizar (al quitar un precio a mano)
 * @param go             navega a una sección
 */
export function useActions({ setData, apply, confirm, notify, fail, refreshQuotes, go }) {
  const onPrice = useCallback(async (isin, price) => {
    try {
      const r = await api.setPrice(isin, price);
      setData((d) => ({
        ...d,
        positions: d.positions.map((p) => (p.isin === isin ? { ...p, price: r.price, priceAt: r.at, priceSource: r.source, priceInfo: null } : p)),
      }));
      if (price == null) refreshQuotes(); // sin precio manual, vuelve la cotización en vivo
    } catch (err) {
      fail(err, 'No se guardó el precio: ');
    }
  }, [fail, refreshQuotes, setData]);

  const onNote = useCallback(async (isin, note) => {
    try {
      const r = await api.setNote(isin, note);
      setData((d) => ({ ...d, positions: d.positions.map((p) => (p.isin === isin ? { ...p, note: r.note } : p)) }));
      return true;
    } catch (err) {
      fail(err, 'No se guardó la nota: ');
      return false;
    }
  }, [fail, setData]);

  /** Guarda un ajuste en la cuenta (se ve al momento; si el servidor lo rechaza, se avisa). */
  const onSetting = useCallback((key, value) => {
    setData((d) => d && ({ ...d, settings: { ...d.settings, [key]: value } }));
    api.setSetting(key, value).catch((err) => fail(err, 'No se guardó: '));
  }, [fail, setData]);

  const saveOp = useCallback(async (op, tid) => {
    apply(await (tid ? api.editTx(tid, op) : api.addTx(op)));
    notify('ok', tid ? 'Operación actualizada.' : 'Operación añadida.');
  }, [apply, notify]);

  const removeOp = useCallback(async (x) => {
    const tids = (x.parts ?? [x]).map((e) => e.tid);
    if (!(await confirm({ title: `¿Quitar esta operación${tids.length > 1 ? ` (${tids.length} ejecuciones)` : ''}?`, text: 'Dejará de contar en tus posiciones. Podrás restaurarla desde Operaciones.', action: 'Quitar', danger: true }))) return;
    try {
      let res;
      for (const tid of tids) res = await api.deleteTx(tid);
      apply(res);
      notify('ok', 'Operación quitada.');
    } catch (err) { fail(err); }
  }, [apply, notify, fail, confirm]);

  const restoreOp = useCallback(async (tid) => {
    try { apply(await api.restoreTx(tid)); notify('ok', 'Operación restaurada.'); } catch (err) { fail(err); }
  }, [apply, notify, fail]);

  const wipe = async () => {
    if (!(await confirm({ title: '¿Borrar todos tus datos?', text: 'Se eliminan tus operaciones, precios, valoraciones, alertas y objetivos. No se puede deshacer: descarga antes una copia si quieres conservarlos.', action: 'Borrar todo', danger: true }))) return;
    try {
      setData(await api.clearData());
      go('resumen');
      notify('ok', 'Datos borrados.');
    } catch (err) {
      fail(err);
    }
  };

  return { onPrice, onNote, onSetting, saveOp, removeOp, restoreOp, wipe };
}
