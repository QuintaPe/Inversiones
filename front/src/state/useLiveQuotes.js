// Cotización en vivo: al entrar (y al volver a la pestaña) se cotiza; después el servidor
// envía los precios por su canal mientras la pestaña está visible. Sin canal, se pide cada minuto.
import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '../api.js';
import { eur, pct, pctS } from '../lib/format.js';

/**
 * @param data     cartera cargada (o null)
 * @param setData  para aplicar los precios que llegan
 * @param apply    sustituye la cartera por la respuesta de una escritura
 * @param hidden   importes ocultos: los avisos del sistema no llevan cifras
 */
export function useLiveQuotes({ data, setData, apply, fail, notify, hidden }) {
  const [live, setLive] = useState({ at: null, failed: [], paused: [], busy: false, error: null });
  const liveBusy = useRef(false);
  const fresh = useRef(0); // cuándo llegaron los últimos precios (refresco o canal)
  const liveOn = !!data?.meta?.liveQuotes && (data?.positions ?? []).some((p) => p.open);

  // Alertas de precio que acaban de saltar: aviso en la app y, si hay permiso, del sistema.
  const announce = useCallback((fired = []) => {
    for (const f of fired) {
      const text = f.dir === 'drop'
        ? `${f.name} cae un ${pct(f.drop ?? f.price)} desde su máximo del último año, hasta ${eur(f.current)}.`
        : f.dir === 'move'
        ? `${f.name} se mueve un ${pctS(f.dayPct ?? 0)} hoy, hasta ${eur(f.current)}.`
        : `${f.name} ha ${f.dir === 'above' ? 'subido hasta' : 'bajado hasta'} ${eur(f.current)} (alerta en ${eur(f.price)}).`;
      notify('ok', text);
      if (window.Notification?.permission === 'granted') new Notification('Alerta de precio', { body: hidden ? `Ha saltado una alerta de ${f.name}.` : text, icon: '/icon-192.png' });
    }
  }, [notify, hidden]);

  const refreshQuotes = useCallback(async () => {
    if (liveBusy.current) return;
    liveBusy.current = true;
    setLive((l) => ({ ...l, busy: true }));
    try {
      const res = await api.refreshQuotes();
      fresh.current = Date.now();
      apply(res);
      setLive({ at: res.refresh.at, failed: res.refresh.failed, paused: res.refresh.paused ?? [], busy: false, error: null });
      announce(res.fired);
    } catch (err) {
      if (err instanceof api.Unauthorized) fail(err);
      setLive((l) => ({ ...l, busy: false, error: err.message }));
    } finally {
      liveBusy.current = false;
    }
  }, [fail, announce, apply]);

  const rowsLoaded = data?.meta?.rows ?? 0;
  const streamOn = !!data?.meta?.stream && typeof window.EventSource === 'function';
  const dataV = useRef(null);
  useEffect(() => { dataV.current = data?.meta?.v; });
  useEffect(() => {
    if (!liveOn) return undefined;
    let es = null, poll = null;
    const open = () => {
      if (!streamOn) { poll ??= setInterval(refreshQuotes, 60_000); return; }
      es = new EventSource('/api/stream');
      es.addEventListener('quotes', (ev) => {
        const q = JSON.parse(ev.data);
        fresh.current = Date.now();
        setData((d) => d && ({
          ...d,
          alerts: q.alerts ?? d.alerts,
          positions: d.positions.map((p) => (q.prices[p.isin] && p.priceSource !== 'manual'
            ? { ...p, price: q.prices[p.isin].price, priceAt: q.prices[p.isin].at, priceSource: 'live', priceInfo: q.prices[p.isin].info }
            : p)),
        }));
        setLive({ at: q.at, failed: q.failed, paused: q.paused ?? [], busy: false, error: null });
        announce(q.fired);
      });
      // Otra pestaña u otro dispositivo ha cambiado las operaciones.
      es.addEventListener('changed', (ev) => {
        if (JSON.parse(ev.data).v !== dataV.current) api.getPortfolio().then(setData).catch(fail);
      });
      // El navegador reintenta solo; si el servidor cierra del todo, se vuelve a pedir cada minuto.
      es.onerror = () => { if (es.readyState === EventSource.CLOSED) { es = null; poll ??= setInterval(refreshQuotes, 60_000); } };
    };
    const close = () => { es?.close(); es = null; clearInterval(poll); poll = null; };
    const onVis = () => {
      // Al volver a la pestaña: precios nuevos solo si los últimos tienen más de un minuto
      // (el servidor los tiene en caché ese tiempo; pedirlos antes solo carga la base de datos).
      if (document.visibilityState === 'visible') { if (Date.now() - fresh.current > 60_000) refreshQuotes(); if (!es && !poll) open(); } else close();
    };
    if (document.visibilityState === 'visible') { refreshQuotes(); open(); }
    document.addEventListener('visibilitychange', onVis);
    return () => { close(); document.removeEventListener('visibilitychange', onVis); };
  }, [liveOn, rowsLoaded, streamOn, refreshQuotes, announce, fail, setData]);

  return { live, liveOn, refreshQuotes };
}
