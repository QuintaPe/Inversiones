// Sesión: quién ha entrado, la configuración del acceso y cómo se entra y se sale.
import { useCallback, useEffect, useState } from 'react';
import * as api from '../api.js';

export function useSession() {
  const [auth, setAuth] = useState(null); // null = cargando; { user, clientId, pushKey, demo }
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api.getConfig(), api.getMe()])
      .then(([cfg, me]) => setAuth({ user: me.user, clientId: cfg.googleClientId, pushKey: cfg.pushKey ?? null, demo: !!cfg.demo }))
      .catch((err) => { setAuth({ user: null, clientId: null }); setError(err.message); });
  }, []);

  const enter = async (call) => {
    setError(null);
    try {
      const { user } = await call();
      setAuth((a) => ({ ...a, user }));
    } catch (err) {
      setError(err.message);
    }
  };
  const login = (credential) => enter(() => api.loginGoogle(credential));
  const loginDemo = () => enter(() => api.loginDemo());

  /**
   * Deja la app sin usuario (sesión caducada o cerrada): la copia sin conexión y los eventos
   * guardados eran de esa sesión. `message` se enseña en la pantalla de acceso.
   */
  const leave = useCallback((message = null) => {
    navigator.serviceWorker?.controller?.postMessage('clear-data');
    api.resetEvents();
    setAuth((a) => ({ ...a, user: null }));
    setError(message);
  }, []);

  return { auth, user: auth?.user ?? null, error, login, loginDemo, leave };
}
