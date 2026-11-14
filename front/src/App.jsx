import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { analyze, taxYears, GROUPS } from './lib/calc.js';
import { time, eur, pctS, setMasked } from './lib/format.js';
import { useStored, usePullToRefresh, PULL_AT } from './hooks.js';
import { useRoute, goBack } from './router.js';
import { RANGES, useRange } from './lib/periods.js';
import { Icon, Menu, Seg, Skeleton, Toasts, UploadButton } from './components/ui.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { Confirm, ImportPreview, Locked, RestorePreview } from './components/Dialogs.jsx';
import { pushSupported, pushEnabled, enablePush, disablePush } from './lib/push.js';

// Cada sección se descarga al abrirla (y las demás en cuanto la app queda libre).
const VIEWS = {
  Dashboard: () => import('./views/Dashboard.jsx'),
  Positions: () => import('./views/Positions.jsx'),
  Ledger: () => import('./views/Ledger.jsx'),
  Dividends: () => import('./views/Dividends.jsx'),
  Tax: () => import('./views/Tax.jsx'),
  Cash: () => import('./views/Cash.jsx'),
  Asset: () => import('./views/Asset.jsx'),
  OpForm: () => import('./components/OpForm.jsx'),
  Palette: () => import('./components/Palette.jsx'),
};
const Dashboard = lazy(VIEWS.Dashboard);
const Positions = lazy(VIEWS.Positions);
const Ledger = lazy(VIEWS.Ledger);
const Dividends = lazy(VIEWS.Dividends);
const Tax = lazy(VIEWS.Tax);
const Cash = lazy(VIEWS.Cash);
const Asset = lazy(VIEWS.Asset);
const OpForm = lazy(VIEWS.OpForm);
const Palette = lazy(VIEWS.Palette);
const Login = lazy(() => import('./components/Login.jsx'));
const prefetchViews = () => {
  const run = () => Object.values(VIEWS).forEach((load) => load().catch(() => {}));
  if ('requestIdleCallback' in window) window.requestIdleCallback(run, { timeout: 4000 });
  else setTimeout(run, 1500);
};

const NAV = [
  ['resumen', 'Resumen'],
  ['posiciones', 'Posiciones'],
  ['operaciones', 'Operaciones'],
  ['dividendos', 'Dividendos'],
  ['fiscalidad', 'Fiscalidad'],
  ['efectivo', 'Efectivo'],
];
const TITLES = Object.fromEntries(NAV);
// Secciones con el título (y sus pestañas o filtros) fijos arriba al hacer scroll.
const STICKY = new Set(['resumen', 'posiciones', 'operaciones', 'dividendos', 'fiscalidad', 'efectivo']);
const THEMES = [['auto', 'Auto'], ['light', 'Claro'], ['dark', 'Oscuro']];
let toastId = 0;

export default function App() {
  const [auth, setAuth] = useState(null); // null = cargando; { user, clientId }
  const [data, setData] = useState(null);
  const [hist, setHist] = useState(undefined); // undefined = cargando; null = no disponible
  const [toasts, setToasts] = useState([]);
  const [loginErr, setLoginErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [flt, setFlt] = useState('all');
  const [over, setOver] = useState(false);
  const [path, go] = useRoute([...NAV.map((n) => n[0]), 'activo'], 'resumen');
  const [route, arg] = path.split('/');
  const openAsset = useCallback((isin) => go(`activo/${isin}`), [go]);
  const [palette, setPalette] = useState(false);
  useEffect(() => {
    const key = (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); setPalette((o) => !o); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);
  const [theme, setTheme] = useStored('theme', 'auto');
  const [hidden, setHidden] = useStored('hide-amounts', false);
  const user = auth?.user ?? null;

  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    // La barra del sistema (móvil, app instalada) toma el fondo del tema elegido; en automático,
    // cada etiqueta de index.html vale para su tema del sistema.
    const metas = document.querySelectorAll('meta[name="theme-color"]');
    metas.forEach((m) => { m.dataset.auto ??= m.content; });
    const bg = theme === 'auto' ? null : getComputedStyle(document.body).backgroundColor;
    metas.forEach((m) => { m.content = bg ?? m.dataset.auto; });
  }, [theme]);
  // Se fija durante el render, antes que los hijos, para que ninguno llegue a pintar una cifra.
  setMasked(!!hidden);
  useEffect(() => { document.documentElement.classList.toggle('private', !!hidden); }, [hidden]);
  const toggleHidden = () => { if (!hidden) setToasts([]); setHidden(!hidden); }; // los avisos ya escritos pueden llevar importes

  const notify = useCallback((kind, text) => setToasts((t) => [...t.slice(-3), { id: ++toastId, kind, text }]), []);
  const closeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Cualquier 401 (sesión caducada) devuelve a la pantalla de acceso.
  const fail = useCallback((err, prefix = '') => {
    if (err instanceof api.Unauthorized) {
      navigator.serviceWorker?.controller?.postMessage('clear-data'); // la copia sin conexión era de esa sesión
      api.resetEvents();
      setAuth((a) => ({ ...a, user: null }));
      setData(null);
      setLoginErr('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    } else {
      notify('err', prefix + err.message);
    }
  }, [notify]);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getMe()])
      .then(([cfg, me]) => setAuth({ user: me.user, clientId: cfg.googleClientId, pushKey: cfg.pushKey ?? null, demo: !!cfg.demo }))
      .catch((err) => { setAuth({ user: null, clientId: null }); setLoginErr(err.message); });
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getPortfolio().then(setData).catch(fail);
    prefetchViews();
  }, [user, fail]);

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
  }, [histKey, histTick]); // eslint-disable-line react-hooks/exhaustive-deps

  const login = async (credential) => {
    setLoginErr(null);
    try {
      const { user: u } = await api.loginGoogle(credential);
      setAuth((a) => ({ ...a, user: u }));
    } catch (err) {
      setLoginErr(err.message);
    }
  };

  const loginDemo = async () => {
    setLoginErr(null);
    try {
      const { user: u } = await api.loginDemo();
      setAuth((a) => ({ ...a, user: u }));
    } catch (err) {
      setLoginErr(err.message);
    }
  };

  // Pregunta de confirmación: `await confirm({ title, text, action, danger })` → true | false.
  const [question, setQuestion] = useState(null);
  const confirm = useCallback((q) => new Promise((resolve) => setQuestion({ ...q, resolve })), []);
  const answer = useCallback((ok) => setQuestion((q) => { q?.resolve(ok); return null; }), []);

  // Avisos en este dispositivo cuando salta una alerta de precio.
  const [pushOn, setPushOn] = useState(false);
  useEffect(() => { if (user) pushEnabled().then(setPushOn).catch(() => {}); }, [user]);
  const togglePush = async () => {
    try {
      if (pushOn) { await disablePush(); setPushOn(false); notify('ok', 'Avisos desactivados en este dispositivo.'); }
      else { await enablePush(auth.pushKey); setPushOn(true); notify('ok', 'Avisos activados: te llegarán las alertas de precio aunque la app esté cerrada.'); }
    } catch (err) { notify('err', err.message); }
  };

  const logout = async () => {
    await disablePush().catch(() => {}); // los avisos de esta cuenta no deben llegar a quien use después el dispositivo
    setPushOn(false);
    await api.logout().catch(() => {});
    api.resetEvents();
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    window.google?.accounts.id.disableAutoSelect();
    setAuth((a) => ({ ...a, user: null }));
    setData(null);
    setToasts([]);
  };

  const logoutOthers = async () => {
    if (!(await confirm({ title: '¿Cerrar sesión en los demás dispositivos?', text: 'Cualquier otro navegador o móvil donde hayas entrado tendrá que volver a iniciar sesión. Aquí sigues dentro.', action: 'Cerrar las demás' }))) return;
    try { await api.logoutOthers(); notify('ok', 'Sesión cerrada en los demás dispositivos.'); } catch (err) { fail(err); }
  };

  // Subir un CSV: primero se enseña qué va a cambiar; solo se guarda al confirmar.
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
      setData({ positions: res.positions, meta: res.meta, alerts: res.alerts, targets: res.targets });
      const u = res.upload;
      notify('ok', `${u.name}: ${u.added} ${u.added === 1 ? 'operación nueva' : 'operaciones nuevas'} de ${u.total} filas.`);
    } catch (err) {
      fail(err);
    } finally {
      setImp(null);
    }
  };

  // Restaurar una copia descargada: igual, primero se enseña qué trae y qué sustituye.
  const [bak, setBak] = useState(null); // { file, preview }
  const bakInput = useRef(null);
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
      setData({ positions: res.positions, meta: res.meta, alerts: res.alerts, targets: res.targets });
      api.getCash().then(setCash).catch(() => {}); // el número de operaciones puede coincidir: se pide a mano
      reloadHistory();
      go('resumen');
      notify('ok', `Copia restaurada: ${res.restored.transactions} ${res.restored.transactions === 1 ? 'operación' : 'operaciones'}.`);
    } catch (err) {
      fail(err);
    } finally {
      setBak(null);
    }
  };

  // ---------- cotización en vivo ----------
  const [live, setLive] = useState({ at: null, failed: [], busy: false, error: null });
  const liveBusy = useRef(false);
  const liveOn = !!data?.meta?.liveQuotes && (data?.positions ?? []).some((p) => p.open);
  // Alertas de precio que acaban de saltar: aviso en la app y, si hay permiso, del sistema.
  const announce = useCallback((fired = []) => {
    for (const f of fired) {
      const text = f.dir === 'move'
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
      setData({ positions: res.positions, meta: res.meta, alerts: res.alerts, targets: res.targets });
      setLive({ at: res.refresh.at, failed: res.refresh.failed, busy: false, error: null });
      announce(res.fired);
    } catch (err) {
      if (err instanceof api.Unauthorized) fail(err);
      setLive((l) => ({ ...l, busy: false, error: err.message }));
    } finally {
      liveBusy.current = false;
    }
  }, [fail, announce]);

  // Al entrar (y al volver a la pestaña) se cotiza; después el servidor envía los precios
  // por su canal mientras la pestaña está visible. Sin canal, se pide cada minuto.
  const rowsLoaded = data?.meta?.rows ?? 0;
  const streamOn = !!data?.meta?.stream && typeof window.EventSource === 'function';
  const dataV = useRef(null);
  dataV.current = data?.meta?.v;
  useEffect(() => {
    if (!liveOn) return undefined;
    let es = null, poll = null;
    const open = () => {
      if (!streamOn) { poll ??= setInterval(refreshQuotes, 60_000); return; }
      es = new EventSource('/api/stream');
      es.addEventListener('quotes', (ev) => {
        const q = JSON.parse(ev.data);
        setData((d) => d && ({
          ...d,
          alerts: q.alerts ?? d.alerts,
          positions: d.positions.map((p) => (q.prices[p.isin] && p.priceSource !== 'manual'
            ? { ...p, price: q.prices[p.isin].price, priceAt: q.prices[p.isin].at, priceSource: 'live', priceInfo: q.prices[p.isin].info }
            : p)),
        }));
        setLive({ at: q.at, failed: q.failed, busy: false, error: null });
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
      if (document.visibilityState === 'visible') { refreshQuotes(); if (!es && !poll) open(); } else close();
    };
    if (document.visibilityState === 'visible') { refreshQuotes(); open(); }
    document.addEventListener('visibilitychange', onVis);
    return () => { close(); document.removeEventListener('visibilitychange', onVis); };
  }, [liveOn, rowsLoaded, streamOn, refreshQuotes, announce, fail]);

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
  }, [fail, refreshQuotes]);

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

  // ---------- operaciones a mano y efectivo ----------
  const [opForm, setOpForm] = useState(null); // null | datos iniciales del formulario
  const [cash, setCash] = useState(undefined);
  const txRows = data?.meta?.rows;
  useEffect(() => {
    if (txRows == null) return undefined;
    let alive = true;
    api.getCash().then((r) => alive && setCash(r)).catch(() => alive && setCash({ cash: null, labels: {} }));
    return () => { alive = false; };
  }, [txRows, data?.meta?.lastUpload?.at]);
  const apply = useCallback((res) => setData({ positions: res.positions, meta: res.meta, alerts: res.alerts, targets: res.targets }), []);
  const patch = useCallback((part) => setData((d) => ({ ...d, ...part })), []);

  // Sin conexión, el service worker sirve los últimos datos guardados.
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const off = () => setOffline(true), on = () => setOffline(false);
    window.addEventListener('offline-data', off);
    window.addEventListener('online-data', on);
    return () => { window.removeEventListener('offline-data', off); window.removeEventListener('online-data', on); };
  }, []);
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

  // Deslizar hacia abajo: cotiza si hay precios en vivo y, si no, vuelve a pedir la cartera.
  const reloadAll = useCallback(() => (liveOn ? refreshQuotes() : api.getPortfolio().then(setData).catch(fail)), [liveOn, refreshQuotes, fail]);
  const ptr = usePullToRefresh(reloadAll, !!user && !!data && !opForm && !palette && !imp && !bak && !question);

  const positions = data?.positions ?? [];
  const a = useMemo(() => analyze(positions, flt), [positions, flt]);
  // La ficha busca el activo en toda la cartera, sin el filtro de tipo.
  const whole = useMemo(() => (flt === 'all' ? a : analyze(positions, 'all')), [a, flt, positions]);
  const assetRow = route === 'activo' ? (whole.o.find((x) => x.p.isin === arg) ?? whole.c.find((x) => x.p.isin === arg)) : null;
  const yearBase = useMemo(() => {
    const y = taxYears(whole.sl, whole.dv, cash?.income).find((r) => r.year === String(new Date().getFullYear()));
    // Resultado del año, menos las pérdidas pendientes de años anteriores, y rendimientos (dividendos, intereses, premios).
    return { gains: (y?.gainTax ?? 0) - (y?.carryIn ?? 0), divs: y?.rcm ?? 0 };
  }, [whole.sl, whole.dv, cash?.income]);
  const back = useCallback(() => goBack('posiciones'), []);

  // Título de la pestaña y, al cambiar de sección, foco en el contenido y aviso para lectores
  // de pantalla (sin esto, el foco se queda en el enlace pulsado y nada anuncia la página nueva).
  const pageTitle = route === 'activo' ? (assetRow?.p.name ?? 'Activo') : TITLES[route];
  useEffect(() => { document.title = user ? `${pageTitle} · Cartera` : 'Cartera'; }, [pageTitle, user]);
  const mainRef = useRef(null);
  // Cabecera fija: la barra y el título de la sección miden lo que miden (cambia con el ancho y
  // con el filtro de tipo); lo que se pega debajo (pestañas, filtros) usa esas alturas.
  const pageH = useRef(null);
  const [range, setRange] = useRange();
  useEffect(() => {
    const root = document.documentElement.style;
    const ro = new ResizeObserver(() => {
      root.setProperty('--bar-h', `${document.querySelector('.bar')?.getBoundingClientRect().height ?? 0}px`);
      root.setProperty('--ph-h', `${pageH.current?.getBoundingClientRect().height ?? 0}px`);
    });
    const bar = document.querySelector('.bar');
    if (bar) ro.observe(bar);
    if (pageH.current) ro.observe(pageH.current);
    else root.setProperty('--ph-h', '0px');
    return () => ro.disconnect();
  }, [path, !!data, flt]); // eslint-disable-line react-hooks/exhaustive-deps
  const [said, setSaid] = useState('');
  const firstPath = useRef(path);
  useEffect(() => {
    if (path === firstPath.current) return;
    firstPath.current = null;
    mainRef.current?.focus({ preventScroll: true });
    setSaid(pageTitle);
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!auth) return <div className="center"><span className="spinner" aria-label="Cargando" /></div>;
  if (!user) {
    return (
      <Suspense fallback={<div className="center"><span className="spinner" aria-label="Cargando" /></div>}>
        <Login clientId={auth.clientId} onCredential={login} error={loginErr} demo={auth.demo} onDemo={loginDemo} />
      </Suspense>
    );
  }

  const empty = data && !positions.length;
  const unknownRows = Object.values(data?.meta?.unknown ?? {}).reduce((t, n) => t + n, 0);
  const groups = GROUPS.filter(([g]) => g === 'all' || positions.some((p) => p.grp === g));
  const view = { a, hist, histProgress, flt, meta: data?.meta, onOpen: openAsset, onPrice, go, cash: cash?.cash, income: cash?.income, onAddOp: setOpForm, onRestoreOp: restoreOp, targets: data?.targets ?? {}, alerts: data?.alerts ?? [], patch, fail };
  const section = route === 'activo' ? 'posiciones' : route;
  const nav = (cls, max = NAV.length) => (
    <nav className={cls} aria-label="Secciones">
      {NAV.slice(0, max).map(([k, label]) => (
        <a key={k} href={`/${k}`} className={section === k ? 'on' : ''} aria-current={section === k ? 'page' : undefined}>
          <Icon name={k} /><span>{label}</span>
        </a>
      ))}
    </nav>
  );
  const liveText = live.busy && !live.at ? 'Cotizando…' : live.error ? 'Sin precios' : live.at ? time(live.at) : 'En vivo';

  const account = (
    <Menu label="Cuenta" button={user.picture
      ? <img className="me" src={user.picture} alt="" referrerPolicy="no-referrer" />
      : <span className="me">{(user.name || user.email)[0].toUpperCase()}</span>}>
      {(close) => (
        <>
          <div className="menu-h"><b>{user.name || 'Mi cuenta'}</b><small>{user.email}</small></div>
          <div className="menu-s">
            <span>Tema</span>
            <Seg label="Tema" options={THEMES} value={theme} onChange={setTheme} />
          </div>
          {data?.meta?.lastUpload && (
            <p className="menu-n">{data.meta.rows} operaciones · último CSV el {data.meta.lastUpload.at.slice(0, 10).split('-').reverse().join('/')}</p>
          )}
          {auth.pushKey && pushSupported() && (
            <button type="button" role="menuitem" onClick={() => { close(); togglePush(); }}>
              <Icon name="bell" size={17} />{pushOn ? 'Desactivar avisos aquí' : 'Avisos en este dispositivo'}
            </button>
          )}
          <a role="menuitem" href={api.EXPORT_URL} download onClick={close}><Icon name="download" size={17} />Descargar una copia</a>
          <button type="button" role="menuitem" onClick={() => { close(); bakInput.current?.click(); }}><Icon name="undo" size={17} />Restaurar una copia</button>
          <button type="button" role="menuitem" onClick={() => { close(); wipe(); }} className="danger"><Icon name="trash" size={17} />Borrar mis datos</button>
          {!user.id.startsWith('demo-') && (
            <button type="button" role="menuitem" onClick={() => { close(); logoutOthers(); }}><Icon name="logout" size={17} />Cerrar en otros dispositivos</button>
          )}
          <button type="button" role="menuitem" onClick={logout}><Icon name="logout" size={17} />Cerrar sesión</button>
        </>
      )}
    </Menu>
  );

  return (
    <div className="shell">
      <a className="skip" href="#main" onClick={(ev) => { ev.preventDefault(); mainRef.current?.focus(); }}>Saltar al contenido</a>
      <header className="bar">
        <div className="bar-in">
          <a className="brand" href="/resumen">cartera<i aria-hidden="true">.</i></a>
          {nav('nav')}
          <div className="bar-a">
            {offline && <span className="live off" title="Sin conexión: ves los últimos datos guardados"><span className="live-dot" aria-hidden="true" />Sin conexión</span>}
            {liveOn && !offline && (
              <button type="button" className={`live ${live.error ? 'off' : ''} ${live.busy ? 'busy' : ''}`} onClick={refreshQuotes} disabled={live.busy}
                title={live.error
                  ? `No se pudo actualizar: ${live.error}`
                  : live.failed.length ? `Sin cotización: ${live.failed.join(', ')}` : 'Cotización en vivo. Pulsa para actualizar ahora'}>
                <span className="live-dot" aria-hidden="true" />{liveText}
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => setPalette(true)} aria-label="Buscar (Ctrl+K)" title="Buscar (Ctrl+K)">
              <Icon name="search" />
            </button>
            <button type="button" className="icon-btn" aria-pressed={!!hidden} onClick={toggleHidden}
              aria-label={hidden ? 'Mostrar importes' : 'Ocultar importes'} title={hidden ? 'Mostrar importes' : 'Ocultar importes'}>
              <Icon name={hidden ? 'eyeOff' : 'eye'} />
            </button>
            <UploadButton onFile={upload} busy={busy} className="icon-btn" label="Subir CSV"><Icon name="upload" /></UploadButton>
            {account}
          </div>
        </div>
      </header>

      <main className="main" id="main" ref={mainRef} tabIndex={-1}>
        {data && !empty && route !== 'activo' && (
          <div className={`page-h ${STICKY.has(route) ? 'sticky-h' : ''}`} ref={pageH}>
            {route !== 'resumen' && <h1>{TITLES[route]}</h1>}
            {/* En el resumen, el periodo afecta a toda la página: va arriba, fijo, donde las demás
                secciones tienen el título; el tipo de activo, a la derecha como en todas. */}
            {route === 'resumen' && <Seg label="Periodo" options={RANGES} value={range} onChange={setRange} />}
            {groups.length > 2 && route !== 'efectivo' && <span className="page-h-r"><Seg label="Tipo de activo" options={groups} value={flt} onChange={setFlt} /></span>}
          </div>
        )}

        {user.id.startsWith('demo-') && (
          <p className="banner info" role="status">
            <Icon name="eye" size={16} />
            <span>Cartera de ejemplo con datos inventados<span className="hide-s">: prueba lo que quieras</span>.</span>
            <button type="button" className="link" onClick={logout}>Salir del ejemplo</button>
          </p>
        )}

        {unknownRows > 0 && route !== 'activo' && (
          <p className="banner" role="status">
            <Icon name="alert" size={16} />
            <span>
              {unknownRows === 1 ? 'Hay 1 fila' : `Hay ${unknownRows} filas`} de tu CSV de un tipo que la app todavía no interpreta
              ({Object.keys(data.meta.unknown).join(', ')}): no {unknownRows === 1 ? 'cuenta' : 'cuentan'} en tus posiciones.
            </span>
          </p>
        )}

        {!data ? (
          <Skeleton />
        ) : empty ? (
          <div
            className={`drop ${over ? 'over' : ''}`}
            onDragOver={(ev) => { ev.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(ev) => { ev.preventDefault(); setOver(false); const f = ev.dataTransfer.files[0]; if (f) upload(f); }}
          >
            <span className="drop-i"><Icon name="upload" size={26} /></span>
            <h2>Sube tus inversiones</h2>
            <p>Arrastra aquí el CSV de transacciones de Trade Republic o elígelo desde tu equipo.</p>
            <UploadButton onFile={upload} busy={busy} className="btn pri">{busy ? 'Subiendo…' : 'Elegir archivo CSV'}</UploadButton>
            <ol className="steps">
              <li><b>1</b>En Trade Republic: Perfil → Transacciones → Exportar CSV.</li>
              <li><b>2</b>Súbelo aquí. De los pagos con tarjeta se guarda el comercio y su categoría, y de las transferencias el nombre de la otra parte, para calcular tu efectivo y ver tus gastos; nunca el IBAN ni el concepto.</li>
              <li><b>3</b>Los precios se actualizan solos con la cotización en vivo.</li>
            </ol>
          </div>
        ) : (
          <ErrorBoundary resetKey={path}>
          <Suspense fallback={<Skeleton />}>
          <div className="view" key={`${path}|${hidden ? 1 : 0}`}>
            {route === 'activo' && (assetRow
              ? <Asset x={assetRow} totalVal={whole.val} yearBase={yearBase} onBack={back} onPrice={onPrice} liveQuotes={liveOn} onHistoryChange={reloadHistory}
                  onAddOp={setOpForm} onRemoveOp={removeOp} alerts={(data.alerts ?? []).filter((al) => al.isin === arg)} patch={patch} fail={fail} />
              : <div className="card"><p className="empty">No tienes ninguna posición con el ISIN {arg}.</p></div>)}
            {route === 'resumen' && <Dashboard {...view} />}
            {route === 'posiciones' && <Positions {...view} />}
            {route === 'operaciones' && <Ledger {...view} />}
            {route === 'dividendos' && <Dividends {...view} />}
            {route === 'fiscalidad' && <Tax {...view} />}
            {route === 'efectivo' && <Cash cash={cash?.cash} labels={cash?.labels ?? {}} cats={cash?.cats ?? {}} onCats={(cats) => setCash((c) => ({ ...c, cats }))}
              budgets={cash?.budgets ?? {}} onBudgets={(budgets) => setCash((c) => ({ ...c, budgets }))} fail={fail} portfolioValue={whole.val} />}
          </div>
          </Suspense>
          </ErrorBoundary>
        )}
      </main>

      {nav('tabs')}
      {opForm && hidden && <Locked title="Importes ocultos" onClose={() => setOpForm(null)} />}
      <Suspense fallback={null}>
        {opForm && !hidden && <OpForm initial={opForm} positions={positions} onSubmit={saveOp} onClose={() => setOpForm(null)} />}
        {palette && data && (
          <Palette sections={NAV} positions={positions} onClose={() => setPalette(false)}
            onGo={(to) => { setPalette(false); go(to); }} />
        )}
      </Suspense>
      {imp && <ImportPreview preview={imp.preview} hasData={!empty} onImport={runImport} onClose={() => setImp(null)} />}
      {bak && <RestorePreview name={bak.file.name} preview={bak.preview} onRestore={runRestore} onClose={() => setBak(null)} />}
      <input ref={bakInput} type="file" accept=".json,application/json" hidden aria-label="Archivo de la copia"
        onChange={(ev) => { const f = ev.target.files[0]; ev.target.value = ''; if (f) pickBackup(f); }} />
      {question && <Confirm {...question} onAnswer={answer} />}
      <p className="sr-only" aria-live="polite">{said}</p>
      {(ptr.pull > 0 || ptr.busy) && (
        <div className={`ptr ${ptr.busy ? 'busy' : ''} ${ptr.pull >= PULL_AT ? 'ready' : ''}`} style={{ '--pull': `${ptr.pull}px`, '--turn': `${(ptr.pull / PULL_AT) * 270}deg` }}
          role="status" aria-label={ptr.busy ? 'Actualizando' : ptr.pull >= PULL_AT ? 'Suelta para actualizar' : 'Desliza para actualizar'}>
          <Icon name="undo" size={18} />
        </div>
      )}
      <Toasts items={toasts} onClose={closeToast} />
    </div>
  );
}
