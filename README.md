# Cartera

Gestor de cartera de inversión a partir de la exportación CSV de Trade Republic.

- `back/` — Node + Express. Sesión con Google, datos en Turso (libSQL), motor de cálculo
  (coste medio y FIFO), cotizaciones e histórico de precios, logotipos.
- `front/` — React + Vite. Resumen, posiciones, ficha de activo, operaciones, dividendos,
  fiscalidad y efectivo. Instalable como app (PWA) en la versión compilada.

## Puesta en marcha

```bash
npm run install:all
cp back/.env.example back/.env   # Turso, Google y SESSION_SECRET
npm run dev:back                 # API en http://127.0.0.1:3001
npm run dev:front                # web en http://localhost:5173
npm test                         # tests del back y de los cálculos del front
```

Sin `TURSO_DATABASE_URL` el back usa un SQLite local (`back/data/local.db`).
Sin `GOOGLE_CLIENT_ID` no se puede iniciar sesión. El back no recarga solo al cambiar `.env`.

## Qué sale de dónde

| Dato | Origen |
|---|---|
| Posiciones, coste, realizado, dividendos | El CSV, operación a operación (`back/src/engine.js`) |
| Precio actual, variación del día, sector | Yahoo Finance por ISIN, sin clave (`back/src/quotes.js`); no oficial |
| Valor diario y rentabilidad | Cierres históricos guardados en la base de datos (`back/src/history.js`) |
| Logotipos | Parqet y Financial Modeling Prep, descargados una vez por el servidor |
| Efectivo | Suma de todos los movimientos del CSV; de tarjeta y transferencias solo fecha e importe |

Las fuentes de precios y logotipos son públicas pero no garantizadas: si fallan, la app
mantiene lo último guardado. `LIVE_QUOTES=0` y `LOGOS=0` las desactivan.

## Publicar

La imagen sirve el front compilado desde el back en un solo puerto:

```bash
docker build -t cartera .
docker run -p 3001:3001 --env-file back/.env -e TRUST_PROXY=1 cartera
```

Antes de exponerla a internet:

1. Ponla detrás de HTTPS (un proxy o la plataforma) y define `TRUST_PROXY=1` para que la
   cookie de sesión salga marcada como segura.
2. Añade el dominio público a los orígenes de JavaScript autorizados del cliente OAuth de Google.
3. Usa un `SESSION_SECRET` propio (`openssl rand -hex 32`) y Turso como base de datos.

El back ya incluye cabeceras de seguridad, compresión, límite de peticiones y `/api/health`.
Cualquier persona con cuenta de Google puede registrarse: cada usuario solo ve sus datos.
