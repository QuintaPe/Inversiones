import { useEffect, useRef, useState } from 'react';

const GIS = 'https://accounts.google.com/gsi/client';
let gisPromise;
const loadGis = () =>
  (gisPromise ??= new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = GIS;
    el.async = true;
    el.onload = resolve;
    el.onerror = () => { gisPromise = null; reject(new Error('No se pudo cargar el inicio de sesión de Google.')); };
    document.head.appendChild(el);
  }));

/** Pantalla de acceso con el botón oficial de Google Identity Services. */
export default function Login({ clientId, onCredential, error, demo = false, onDemo }) {
  const [trying, setTrying] = useState(false);
  const ref = useRef(null);
  const [loadErr, setLoadErr] = useState(null);
  const cb = useRef(onCredential);
  cb.current = onCredential;

  useEffect(() => {
    if (!clientId) return;
    let alive = true;
    loadGis()
      .then(() => {
        if (!alive) return;
        window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => cb.current(r.credential) });
        window.google.accounts.id.renderButton(ref.current, {
          theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es',
        });
      })
      .catch((err) => alive && setLoadErr(err.message));
    return () => { alive = false; };
  }, [clientId]);

  const err = error || loadErr;
  return (
    <div className="login">
      <section className="login-a">
        <div className="brand"><span className="logo" aria-hidden="true" /> Cartera</div>
        <h1>Tu cartera, explicada cifra a cifra.</h1>
        <ul>
          <li><b>Posiciones y resultado</b>Coste medio, P&amp;L latente y realizado, con cada cálculo a la vista.</li>
          <li><b>Cotización en vivo</b>Precios por ISIN convertidos a euros, actualizados cada minuto.</li>
          <li><b>Dividendos y fiscalidad</b>Cobros, retenciones y ganancias patrimoniales por ejercicio (FIFO).</li>
        </ul>
      </section>
      <section className="login-c">
        <h2>Inicia sesión</h2>
        <p>Tus datos quedan asociados a tu cuenta de Google y solo tú puedes verlos.</p>
        {err && <div className="toast err inline" role="alert"><span>{err}</span></div>}
        {clientId ? (
          <div ref={ref} className="gbtn" />
        ) : (
          <div className="note">
            Falta configurar el acceso con Google en el servidor: define <code>GOOGLE_CLIENT_ID</code> en{' '}
            <code>back/.env</code> (pasos en <code>back/.env.example</code>) y reinicia el back.
          </div>
        )}
        {demo && (
          <div className="login-demo">
            <span>o</span>
            <button type="button" className="btn wide" disabled={trying}
              onClick={async () => { setTrying(true); try { await onDemo(); } finally { setTrying(false); } }}>
              {trying ? 'Preparando el ejemplo…' : 'Probar con una cartera de ejemplo'}
            </button>
            <small>Datos inventados con valores reales. Se borran solos en una semana.</small>
          </div>
        )}
      </section>
    </div>
  );
}
