// Datos de la cartera del usuario: posiciones, histórico diario y efectivo.
import { useCallback, useEffect, useState } from 'react';
import * as api from '../api.js';

/**
 * @param user  usuario de la sesión, o null
 * @param fail  (error) => void; trata los errores (y la sesión caducada)
 */
export function usePortfolio({ user, fail }) {
  const [data, setData] = useState(null);
  const [hist, setHist] = useState(undefined); // undefined = cargando; null = no disponible
  const [cash, setCash] = useState(undefined);

  useEffect(() => {
    // Sin usuario no queda nada suyo en memoria.
    if (!user) { setData(null); setCash(undefined); return; }
    api.getPortfolio().then(setData).catch(fail);
  }, [user, fail]);

  /** Sustituye la cartera por la que devuelve una escritura. */
  const apply = useCallback((res) => setData((d) => ({ positions: res.positions, meta: res.meta, alerts: res.alerts, targets: res.targets, settings: res.settings ?? d?.settings ?? {} })), []);
  const patch = useCallback((part) => setData((d) => ({ ...d, ...part })), []);
  const reload = useCallback(() => api.getPortfolio().then(setData).catch(fail), [fail]);

  // Histórico diario: se recalcula cuando cambian las operaciones o un precio manual.
  const histKey = data ? `${data.meta.rows}|${data.positions.filter((p) => p.priceSource === 'manual').map((p) => p.isin + p.price).join()}` : null;
  const [histTick, setHistTick] = useState(0);
  const [histProgress, setHistProgress] = useState(null); // { done, total } mientras se reconstruye
  const reloadHistory = useCallback(() => setHistTick((n) => n + 1), []);
  useEffect(() => {
    if (!histKey || !data.meta.history || !data.meta.rows) { setHist(histKey ? null : undefined); return undefined; }
    let alive = true, timer = null;
    // Si el servidor aún la está reconstruyendo, enseña la última guardada (si hay) y se vuelve a preguntar.
    const ask = () => api.getHistory()
      .then((r) => {
        if (!alive) return;
        if (r.pending) {
          if (r.history) setHist(r.history);
          setHistProgress(r.progress ?? { done: 0, total: 0 });
          timer = setTimeout(ask, 1500);
          return;
        }
        setHistProgress(null);
        setHist(r.history);
        // El histórico acaba de descubrir un split: las posiciones se piden otra vez, ya ajustadas.
        if (r.history && (r.history.splits ?? 0) !== (data.meta.splits ?? 0)) api.getPortfolio().then((d) => alive && setData(d)).catch(() => {});
      })
      .catch((err) => { if (alive) { setHist(null); setHistProgress(null); if (err instanceof api.Unauthorized) fail(err); } });
    ask();
    return () => { alive = false; clearTimeout(timer); };
  }, [histKey, histTick]); // eslint-disable-line react-hooks/exhaustive-deps -- data y fail se leen del pintado que cambió la clave

  // Efectivo: se vuelve a pedir cuando cambian las operaciones.
  const txRows = data?.meta?.rows;
  const reloadCash = useCallback(() => api.getCash().then(setCash).catch(() => {}), []);
  useEffect(() => {
    if (txRows == null) return undefined;
    let alive = true;
    api.getCash().then((r) => alive && setCash(r)).catch(() => alive && setCash({ cash: null, labels: {} }));
    return () => { alive = false; };
  }, [txRows, data?.meta?.lastUpload?.at]);

  return { data, setData, apply, patch, reload, hist, histProgress, reloadHistory, cash, setCash, reloadCash };
}
