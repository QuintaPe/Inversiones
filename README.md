# Cartera

Gestor de cartera de inversión a partir de la exportación CSV de Trade Republic.

- `back/` — Node + Express. Sesión con Google, datos en Turso (libSQL), motor de cálculo
  (coste medio y FIFO), cotizaciones e histórico de precios, logotipos, vigilancia de
  alertas y avisos push.
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
| Precio actual, variación del día, sector | Yahoo Finance por ISIN, sin clave (`back/src/quotes.js`); no oficial. Si no conoce el ISIN, el símbolo se busca en OpenFIGI |
| Valor diario y rentabilidad | Cierres históricos guardados en la base de datos (`back/src/history.js`) |
| Logotipos | Parqet y Financial Modeling Prep, descargados una vez por el servidor |
| Efectivo | Suma de todos los movimientos del CSV; de tarjeta y transferencias solo fecha e importe |

Las fuentes de precios y logotipos son públicas pero no garantizadas: si fallan, la app
mantiene lo último guardado. `LIVE_QUOTES=0` y `LOGOS=0` las desactivan.

## Base de datos

El esquema se crea y se actualiza solo al arrancar, con migraciones numeradas
(`MIGRATIONS` en `back/src/db.js`, anotadas en la tabla `schema_migrations`). Para cambiarlo
se añade una migración nueva al final; las ya publicadas no se tocan.

| Tabla | Contenido |
|---|---|
| `transactions` | Operaciones del CSV y a mano (`source`), con borrado lógico (`deleted_at`) |
| `imports` | Cada archivo subido, con su huella SHA-256 |
| `quotes` | Última cotización de cada valor, compartida entre usuarios |
| `prices`, `valuations` | Precios y valoraciones que el usuario fija a mano |
| `symbols`, `price_history`, `symbol_divs`, `symbol_splits`, `history_meta` | Caché global de mercado |
| `alerts`, `targets`, `push_subscriptions` | Alertas, cartera objetivo y dispositivos con avisos |

Los importes se guardan como texto decimal exacto, tal cual vienen en el CSV. De los pagos
con tarjeta y las transferencias no se guarda comercio, IBAN, concepto ni categoría.
Al subir un CSV se enseña primero qué va a cambiar; `GET /api/export` descarga una copia
completa de los datos del usuario.

## Alertas y avisos

El servidor cotiza cada pocos minutos (`ALERT_SWEEP_MIN`) los valores con alertas pendientes
y avisa por Web Push a los dispositivos donde el usuario lo haya activado, aunque la app
esté cerrada. Las claves VAPID se generan solas y se guardan en la base de datos. Los avisos
necesitan HTTPS y la versión compilada (service worker); en iOS, además, la app instalada.

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

El back ya incluye cabeceras de seguridad con política de contenido (`CSP=0` la desactiva),
compresión, límite de peticiones y `/api/health`. Define `PUSH_SUBJECT` con un contacto real
para los avisos.
Cualquier persona con cuenta de Google puede registrarse: cada usuario solo ve sus datos.
