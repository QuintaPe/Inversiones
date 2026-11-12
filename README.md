# Cartera

Visor de inversiones a partir de la exportación CSV de Trade Republic.

- `back/` — Node + Express. Verifica el inicio de sesión de Google, guarda los datos en Turso (libSQL) y calcula las posiciones (coste medio ponderado).
- `front/` — React + Vite.

## Puesta en marcha

```bash
npm run install:all
cp back/.env.example back/.env   # y rellénalo (Turso, Google, SESSION_SECRET)
npm run dev:back                 # API en http://127.0.0.1:3001
npm run dev:front                # web en http://localhost:5173
```

Sin `TURSO_DATABASE_URL` el back usa un SQLite local (`back/data/local.db`).
Sin `GOOGLE_CLIENT_ID` no se puede iniciar sesión.

Producción: `npm run build && npm start` (el back sirve `front/dist` en el puerto 3001).

Tests: `npm test`.
