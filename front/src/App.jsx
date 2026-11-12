import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as api from './api.js';
import { analyze, taxYears, GROUPS } from './lib/calc.js';
import { time } from './lib/format.js';
import { useHashRoute, useStored } from './hooks.js';
import { Icon, Menu, Seg, Skeleton, Toasts, UploadButton } from './components/ui.jsx';
import Login from './components/Login.jsx';
import Palette from './components/Palette.jsx';
import Asset from './views/Asset.jsx';
import Cash from './views/Cash.jsx';
import OpForm from './components/OpForm.jsx';
import Dashboard from './views/Dashboard.jsx';
import Positions from './views/Positions.jsx';
import Ledger from './views/Ledger.jsx';
import Dividends from './views/Dividends.jsx';
import Tax from './views/Tax.jsx';

const NAV = [
  ['resumen', 'Resumen'],
  ['posiciones', 'Posiciones'],
  ['operaciones', 'Operaciones'],
  ['dividendos', 'Dividendos'],
  ['fiscalidad', 'Fiscalidad'],
  ['efectivo', 'Efectivo'],
];
const TITLES = Object.fromEntries(NAV);
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
  const [path, go] = useHashRoute([...NAV.map((n) => n[0]), 'activo'], 'resumen');
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
  }, [theme]);
  useEffect(() => { document.documentElement.classList.toggle('private', !!hidden); }, [hidden]);

  const notify = useCallback((kind, text) => setToasts((t) => [...t.slice(-3), { id: ++toastId, kind, text }]), []);
  const closeToast = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Cualquier 401 (sesión caducada) devuelve a la pantalla de acceso.
  const fail = useCallback((err, prefix = '') => {
    if (err instanceof api.Unauthorized) {
      setAuth((a) => ({ ...a, user: null }));
      setData(null);
      setLoginErr('Tu sesión ha caducado. Vuelve a iniciar sesión.');
    } else {
      notify('err', prefix + err.message);
    }
  }, [notify]);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getMe()])
      .then(([cfg, me]) => setAuth({ user: me.user, clientId: cfg.googleClientId }))
      .catch((err) => { setAuth({ user: null, clientId: null }); setLoginErr(err.message); });
  }, []);

  useEffect(() => {
    if (!user) return;
    api.getPortfolio().then(setData).catch(fail);
  }, [user, fail]);

  // Histórico diario: se recalcula cuando cambian las operaciones o un precio manual.
  const histKey = data ? `${data.meta.rows}|${data.positions.filter((p) => p.priceSource === 'manual').map((p) => p.isin + p.price).join()}` : null;
  const [histTick, setHistTick] = useState(0);
  const reloadHistory = useCallback(() => setHistTick((n) => n + 1), []);
  useEffect(() => {
    if (!histKey || !data.meta.history || !data.meta.rows) { setHist(histKey ? null : undefined); return undefined; }
    let alive = true;
    api.getHistory()
      .then((r) => alive && setHist(r.history))
      .catch((err) => { if (alive) { setHist(null); if (err instanceof api.Unauthorized) fail(err); } });
    return () => { alive = false; };
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

  const logout = async () => {
    await api.logout().catch(() => {});
    window.google?.accounts.id.disableAutoSelect();
    setAuth((a) => ({ ...a, user: null }));
    setData(null);
    setToasts([]);
  };

  const upload = async (file) => {
    setBusy(true);
    try {
      const res = await api.uploadCsv(file);
      setData({ positions: res.positions, meta: res.meta });
      const u = res.upload;
      notify('ok', `${u.name}: ${u.total} filas leídas, ${u.relevant} de inversión, ${u.added} nuevas.`);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // ---------- cotización en vivo ----------
  const [live, setLive] = useState({ at: null, failed: [], busy: false, error: null });
  const liveBusy = useRef(false);
  const liveOn = !!data?.meta?.liveQuotes && (data?.positions ?? []).some((p) => p.open && p.grp === 'ac');
  const refreshQuotes = useCallback(async () => {
    if (liveBusy.current) return;
    liveBusy.current = true;
    setLive((l) => ({ ...l, busy: true }));
    try {
      const res = await api.refreshQuotes();
      setData({ positions: res.positions, meta: res.meta });
      setLive({ at: res.refresh.at, failed: res.refresh.failed, busy: false, error: null });
    } catch (err) {
      if (err instanceof api.Unauthorized) fail(err);
      setLive((l) => ({ ...l, busy: false, error: err.message }));
    } finally {
      liveBusy.current = false;
    }
  }, [fail]);

  // Al entrar y cada minuto, solo con la pestaña visible.
  const rowsLoaded = data?.meta?.rows ?? 0;
  useEffect(() => {
    if (!liveOn) return undefined;
    const tick = () => document.visibilityState === 'visible' && refreshQuotes();
    tick();
    const id = setInterval(tick, 60_000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', tick); };
  }, [liveOn, rowsLoaded, refreshQuotes]);

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
    if (!window.confirm('¿Borrar todas tus operaciones y precios guardados? No se puede deshacer.')) return;
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
  const apply = useCallback((res) => setData({ positions: res.positions, meta: res.meta }), []);
  const saveOp = useCallback(async (op, tid) => {
    apply(await (tid ? api.editTx(tid, op) : api.addTx(op)));
    notify('ok', tid ? 'Operación actualizada.' : 'Operación añadida.');
  }, [apply, notify]);
  const removeOp = useCallback(async (x) => {
    const tids = (x.parts ?? [x]).map((e) => e.tid);
    if (!window.confirm(`¿Quitar esta operación${tids.length > 1 ? ` (${tids.length} ejecuciones)` : ''}? Podrás restaurarla desde Operaciones.`)) return;
    try {
      let res;
      for (const tid of tids) res = await api.deleteTx(tid);
      apply(res);
      notify('ok', 'Operación quitada.');
    } catch (err) { fail(err); }
  }, [apply, notify, fail]);
  const restoreOp = useCallback(async (tid) => {
    try { apply(await api.restoreTx(tid)); notify('ok', 'Operación restaurada.'); } catch (err) { fail(err); }
  }, [apply, notify, fail]);

  const positions = data?.positions ?? [];
  const a = useMemo(() => analyze(positions, flt), [positions, flt]);
  // La ficha busca el activo en toda la cartera, sin el filtro de tipo.
  const whole = useMemo(() => (flt === 'all' ? a : analyze(positions, 'all')), [a, flt, positions]);
  const assetRow = route === 'activo' ? (whole.o.find((x) => x.p.isin === arg) ?? whole.c.find((x) => x.p.isin === arg)) : null;
  const yearBase = useMemo(() => {
    const y = taxYears(whole.sl, whole.dv).find((r) => r.year === String(new Date().getFullYear()));
    return { gains: y?.gainF ?? 0, divs: y?.divG ?? 0 };
  }, [whole.sl, whole.dv]);
  const back = useCallback(() => (window.history.length > 1 ? window.history.back() : go('posiciones')), [go]);

  if (!auth) return <div className="center"><span className="spinner" aria-label="Cargando" /></div>;
  if (!user) return <Login clientId={auth.clientId} onCredential={login} error={loginErr} />;

  const empty = data && !positions.length;
  const groups = GROUPS.filter(([g]) => g === 'all' || positions.some((p) => p.grp === g));
  const view = { a, hist, flt, meta: data?.meta, onOpen: openAsset, onPrice, go, cash: cash?.cash, onAddOp: setOpForm, onRestoreOp: restoreOp };
  const section = route === 'activo' ? 'posiciones' : route;
  const nav = (cls, max = NAV.length) => (
    <nav className={cls} aria-label="Secciones">
      {NAV.slice(0, max).map(([k, label]) => (
        <a key={k} href={`#/${k}`} className={section === k ? 'on' : ''} aria-current={section === k ? 'page' : undefined}>
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
          <button type="button" role="menuitem" onClick={() => { close(); wipe(); }} className="danger"><Icon name="trash" size={17} />Borrar mis datos</button>
          <button type="button" role="menuitem" onClick={logout}><Icon name="logout" size={17} />Cerrar sesión</button>
        </>
      )}
    </Menu>
  );

  return (
    <div className="shell">
      <header className="bar">
        <div className="bar-in">
          <a className="brand" href="#/resumen">cartera<i aria-hidden="true">.</i></a>
          {nav('nav')}
          <div className="bar-a">
            {liveOn && (
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
            <button type="button" className="icon-btn" aria-pressed={!!hidden} onClick={() => setHidden(!hidden)}
              aria-label={hidden ? 'Mostrar importes' : 'Ocultar importes'} title={hidden ? 'Mostrar importes' : 'Ocultar importes'}>
              <Icon name={hidden ? 'eyeOff' : 'eye'} />
            </button>
            <UploadButton onFile={upload} busy={busy} className="icon-btn" label="Subir CSV"><Icon name="upload" /></UploadButton>
            {account}
          </div>
        </div>
      </header>

      <main className="main">
        {data && !empty && route !== 'activo' && (
          <div className="page-h">
            {route !== 'resumen' && <h1>{TITLES[route]}</h1>}
            {groups.length > 2 && route !== 'efectivo' && <Seg label="Tipo de activo" options={groups} value={flt} onChange={setFlt} />}
          </div>
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
              <li><b>2</b>Súbelo aquí. De los pagos con tarjeta y las transferencias solo se guarda fecha e importe, para calcular tu efectivo.</li>
              <li><b>3</b>Los precios se actualizan solos con la cotización en vivo.</li>
            </ol>
          </div>
        ) : (
          <div className="view" key={path}>
            {route === 'activo' && (assetRow
              ? <Asset x={assetRow} totalVal={whole.val} yearBase={yearBase} onBack={back} onPrice={onPrice} liveQuotes={liveOn} onHistoryChange={reloadHistory}
                  onAddOp={setOpForm} onRemoveOp={removeOp} />
              : <div className="card"><p className="empty">No tienes ninguna posición con el ISIN {arg}.</p></div>)}
            {route === 'resumen' && <Dashboard {...view} />}
            {route === 'posiciones' && <Positions {...view} />}
            {route === 'operaciones' && <Ledger {...view} />}
            {route === 'dividendos' && <Dividends {...view} />}
            {route === 'fiscalidad' && <Tax {...view} />}
            {route === 'efectivo' && <Cash cash={cash?.cash} labels={cash?.labels ?? {}} portfolioValue={whole.val} />}
          </div>
        )}
      </main>

      {nav('tabs', 5)}
      {opForm && <OpForm initial={opForm} positions={positions} onSubmit={saveOp} onClose={() => setOpForm(null)} />}
      {palette && data && (
        <Palette sections={NAV} positions={positions} onClose={() => setPalette(false)}
          onGo={(to) => { setPalette(false); go(to); }} />
      )}
      <Toasts items={toasts} onClose={closeToast} />
    </div>
  );
}
