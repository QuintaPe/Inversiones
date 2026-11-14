// Subir un CSV y restaurar una copia: primero se enseña qué va a cambiar; solo se guarda al confirmar.
import { useState } from 'react';
import * as api from '../api.js';

/**
 * @param apply       sustituye la cartera por la respuesta del servidor
 * @param onRestored  () => void; tras restaurar una copia (cambia todo: efectivo, histórico…)
 */
export function useImports({ apply, fail, notify, onRestored }) {
  const [busy, setBusy] = useState(false);
  const [imp, setImp] = useState(null); // { file, preview }
  const upload = async (file) => {
    setBusy(true);
    try {
      setImp({ file, preview: (await api.previewCsv(file)).preview });
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };
  const runImport = async (replace) => {
    try {
      const res = await api.uploadCsv(imp.file, replace);
      apply(res);
      const u = res.upload;
      notify('ok', `${u.name}: ${u.added} ${u.added === 1 ? 'operación nueva' : 'operaciones nuevas'} de ${u.total} filas.`);
    } catch (err) {
      fail(err);
    } finally {
      setImp(null);
    }
  };

  const [bak, setBak] = useState(null); // { file, preview }
  const pickBackup = async (file) => {
    try {
      setBak({ file, preview: (await api.previewBackup(file)).preview });
    } catch (err) {
      fail(err);
    }
  };
  const runRestore = async () => {
    try {
      const res = await api.restoreBackup(bak.file);
      apply(res);
      onRestored();
      notify('ok', `Copia restaurada: ${res.restored.transactions} ${res.restored.transactions === 1 ? 'operación' : 'operaciones'}.`);
    } catch (err) {
      fail(err);
    } finally {
      setBak(null);
    }
  };

  return { busy, imp, upload, runImport, cancelImport: () => setImp(null), bak, pickBackup, runRestore, cancelRestore: () => setBak(null) };
}
