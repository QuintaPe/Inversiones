# Cartera

Gestor de cartera de inversión a partir de la exportación CSV de Trade Republic.

- `back/` — Node + Express. Sesión con Google, datos en Turso (libSQL), motor de cálculo
  (coste medio y FIFO), cotizaciones e histórico de precios, logotipos, vigilancia de
  alertas y avisos push. `src/app.js` monta la aplicación; las rutas están por dominio en
  `src/routes/` y la cartera calculada (con su caché) en `src/services/portfolio.js`.
- `shared/` — cálculos en JavaScript puro, sin dependencias, que usan el front y el back:
  agregados y fiscalidad (`calc.js`), rentabilidad por periodo (`perf.js`) y salud del efectivo (`cash.js`).
- `front/` — React + Vite. Resumen, posiciones, ficha de activo, operaciones, dividendos,
  fiscalidad y efectivo con gastos por categoría. Instalable como app (PWA) en la versión compilada.
  El estado de la app está en hooks (`front/src/state/`): sesión, cartera con su histórico y efectivo,
  cotización en vivo, importaciones y lo que se cambia a mano; `App.jsx` los une y pinta la barra y las rutas.

## Puesta en marcha

```bash
npm run install:all
cp back/.env.example back/.env   # Turso, Google y SESSION_SECRET
npm run dev:back                 # API en http://127.0.0.1:3001
npm run dev:front                # web en http://localhost:5173
npm test                         # tests del back y de los cálculos del front
npm run e2e                      # la app real en Chromium: escritorio, tableta y móvil, claro y oscuro
npm run check                    # lint, tipos, tests y build con sus presupuestos: lo que se pasa antes de subir
```

La primera vez, `npx playwright install chromium-headless-shell` descarga el navegador de las pruebas.

`npm run lint` (ESLint, `eslint.config.mjs`) y `npm run types` (TypeScript sobre los JSDoc del código
de cálculo, `tsconfig.json`) no admiten avisos. `git config core.hooksPath .githooks` hace que
`npm run check` se ejecute solo antes de cada `git push`.

Sin `TURSO_DATABASE_URL` el back usa un SQLite local (`back/data/local.db`).
Sin `GOOGLE_CLIENT_ID` no se puede iniciar sesión. El back no recarga solo al cambiar `.env`.

## Qué sale de dónde

| Dato | Origen |
|---|---|
| Posiciones, coste, realizado, dividendos | El CSV, operación a operación (`back/src/engine.js`) |
| Precio actual, variación del día, sector | Yahoo Finance por ISIN, sin clave (`back/src/quotes.js`); no oficial. Si no conoce el ISIN, el símbolo se busca en OpenFIGI |
| Valor liquidativo de fondos no cotizados (Private Markets) | onvista por ISIN, último publicado y su histórico mensual; no oficial |
| Valor diario y rentabilidad | Cierres históricos guardados en la base de datos (`back/src/history.js`) |
| Logotipos | Parqet y Financial Modeling Prep, descargados una vez por el servidor |
| Efectivo y gastos | Suma de todos los movimientos del CSV; los gastos se agrupan por el comercio y su categoría (MCC), o la que elijas para cada comercio |

Las fuentes de precios y logotipos son públicas pero no garantizadas: si fallan, la app
mantiene lo último guardado. `LIVE_QUOTES=0` y `LOGOS=0` las desactivan.

Un fallo pasajero (red, 429, 5xx) se reintenta con espera creciente. Tras cuatro fallos seguidos
de un proveedor se le deja de llamar un minuto (que se va doblando hasta quince si sigue caído) y
se avisa en el registro. Si Yahoo no da un tipo de cambio, se usa el de referencia del BCE.

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
| `merchant_categories`, `budgets` | Categoría que el usuario elige para un comercio y topes de gasto al mes |
| `watchlist`, `asset_notes` | Valores en seguimiento (sin tenerlos) y nota libre de cada activo |

Los importes se guardan como texto decimal exacto, tal cual vienen en el CSV. De los pagos
con tarjeta se guarda el comercio y su código de categoría (MCC), y de las transferencias el
nombre de la otra parte, para ver y categorizar los gastos; nunca el concepto, el IBAN ni la
referencia de la transferencia.
Al subir un CSV se enseña primero qué va a cambiar; `GET /api/export` descarga una copia
completa de los datos del usuario, y «Restaurar una copia» (menú de la cuenta,
`POST /api/import`) la vuelve a cargar: enseña qué trae, sustituye todo lo que hay en la cuenta
en una sola transacción y valida cada dato del archivo antes de guardarlo (`back/src/backup.js`).

## Qué más hace

- **Rentabilidad**: por periodo, con tus aportaciones (Dietz), ponderada por tiempo, anualizada
  (TIR, desde tres meses), caída máxima, volatilidad e índices con tus mismas aportaciones.
- **Proyección** (Resumen): aportación mensual, rentabilidad esperada ±3 puntos y una meta de
  patrimonio con la fecha en que se alcanza. Lo que escribes se queda en el navegador.
- **Antes de que acabe el año** (Fiscalidad): qué baja tu cuota si afloras hoy cada pérdida
  latente (con el límite del 25 % y lo que quedaría pendiente) y cuánta ganancia puedes realizar
  sin pagar más.
- **Topes de gasto** (Efectivo → Gastos): al mes, total y por categoría.
- **Seguimiento** (Posiciones): valores que no tienes, por ISIN, cotizados con tu cartera.
- **Nota de cada activo** en su ficha.

## Alertas y avisos

Hay alertas de precio (sube o baja de un nivel) y de movimiento (el valor se mueve más de un
porcentaje en el día, en cualquier sentido). Cada una salta una sola vez.


El servidor cotiza cada pocos minutos (`ALERT_SWEEP_MIN`) los valores con alertas pendientes
y avisa por Web Push a los dispositivos donde el usuario lo haya activado, aunque la app
esté cerrada. Las claves VAPID se generan solas y se guardan en la base de datos. Los avisos
necesitan HTTPS y la versión compilada (service worker); en iOS, además, la app instalada.

## Pruebas de extremo a extremo

`npm run e2e` compila el front y lo sirve con el back real (base de datos en memoria, sin
proveedores externos ni límites de peticiones) sobre la cartera de ejemplo con precios fijos.
Recorre cada sección en seis configuraciones (escritorio, tableta y móvil, en claro y en
oscuro) y comprueba que no hay errores en la consola ni scroll horizontal. También cubre la
navegación, el teclado en las gráficas, el tema y los gestos táctiles.

Para cambios de estilos, `npm run e2e:visual:base` guarda una captura de cada sección *antes*
de tocar nada y `npm run e2e:visual` compara después. La cartera de ejemplo se fecha desde
hoy, así que las capturas solo sirven para comparar el mismo día y no se versionan.

## Interfaz

- **Rutas**: URLs limpias (`/posiciones`, `/activo/US0378331005`). Pestañas, filtros y periodos
  van en la URL (`/operaciones?tipo=ventas&año=2025`), así que se pueden recargar, enlazar y
  compartir. Al volver atrás se recupera el scroll, y los enlaces antiguos con `#/` siguen
  funcionando (`front/src/router.js`, sin dependencias).
- **Estilos**: una sola hoja, `front/src/styles.css` (ver Diseño).
- **Accesibilidad**: enlace para saltar al contenido, foco y aviso al cambiar de sección, y
  gráficas que se recorren con las flechas y anuncian el punto activo.
- **Móvil**: deslizar hacia abajo desde arriba actualiza las cotizaciones sin recargar la app,
  y la app instalada tiene accesos directos a las secciones principales.

## Rendimiento

- Cada respuesta lleva `Server-Timing` (pestaña Red del navegador) con el tiempo de base de
  datos, cálculo y proveedores externos. Las peticiones de más de `SLOW_MS` (1000 ms) salen en
  el registro.
- `npm run bench --prefix back` mide el motor y la API con una cartera sintética;
  `-- --latency 40` simula la ida y vuelta a Turso y `-- --rows 50000` cambia el tamaño.
- `npm run build` falla si el front supera su presupuesto de tamaño (`front/scripts/budget.js`).
- En Operaciones, los meses fuera de pantalla no se maquetan hasta acercarse (`content-visibility`)
  y las siguientes 100 filas se cargan solas al llegar al final.
- Cachés en memoria de usuarios, operaciones, símbolos, splits y posiciones calculadas; se
  invalidan en cada escritura. Suponen un solo proceso (`DB_CACHE=0` las desactiva).
- `TURSO_REPLICA=replica.db` usa Turso como réplica embebida: las lecturas no cruzan la red.
- Las pestañas abiertas reciben las cotizaciones por `GET /api/stream` (Server-Sent Events):
  el servidor cotiza cada `QUOTE_STREAM_SEC` segundos una sola vez para todos los conectados,
  y avisa a las demás pestañas cuando cambian las operaciones.
- La cartera viaja sin los eventos de cada posición; van en `GET /api/events`, con `ETag`, y el
  cliente solo los pide cuando cambia su huella (`meta.ev`).
- El histórico calculado se guarda en `history_cache`. Si hay que reconstruirlo y tarda,
  `GET /api/history` responde enseguida con `{ pending, progress }` y la última serie guardada.
- Front: secciones bajo demanda (`React.lazy`) precargadas en reposo, React Compiler, solo las
  fuentes latinas, gráficas reducidas a los puntos visibles y el service worker guarda de
  antemano todo lo que lista `asset-manifest.json`.

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
compresión y límite de peticiones. Define `PUSH_SUBJECT` con un contacto real para los avisos.

- **Salud**: `/api/health` comprueba que la base de datos responde; devuelve 503 si no, o si el
  servidor se está apagando.
- **Apagado**: con SIGTERM deja de aceptar peticiones, cierra los canales de cotizaciones (las
  pestañas reconectan solas), espera a las peticiones en curso hasta `SHUTDOWN_MS` y cierra la
  base de datos.
- **Registro**: con `NODE_ENV=production` (o `LOG_FORMAT=json`) cada línea es un objeto JSON. Los
  errores sin tratar llevan el identificador de la petición, que también va en la cabecera
  `X-Request-Id` y en la respuesta 500, para poder buscarlos.
- **Copias automáticas**: una vez al día el servidor guarda cada cuenta en
  `back/data/backups/AAAA-MM-DD/<usuario>.json.gz` (`BACKUP_DIR` la cambia; `back/src/autobackup.js`),
  con el mismo formato que «Descargar una copia»: se descomprime (`gunzip`) y se carga con
  «Restaurar una copia». Conserva las 14 últimas y una por semana de las 8 semanas anteriores.
  En Docker, monta un volumen en `/app/back/data` para que sobrevivan al contenedor.
- **Sesiones**: la cookie dura 30 días. «Cerrar en otros dispositivos» (menú de la cuenta)
  invalida todas las demás sesiones del usuario.
Cualquier persona con cuenta de Google puede registrarse: cada usuario solo ve sus datos.
Desde el acceso también se puede probar una cartera de ejemplo (`back/src/demo.js`): crea una
cuenta temporal con valores reales y operaciones inventadas, que se borra a la semana (`DEMO=0` la quita).

## Diseño

Los colores, espacios, tamaños de letra y tiempos de animación son variables de `:root` en
`front/src/styles.css`. Cada color se escribe una sola vez como `light-dark(claro, oscuro)`;
el tema lo decide el sistema o el que se elige en la app (`data-theme` en `<html>`).
Lightning CSS (`vite.config.js`) traduce `light-dark()` y añade los prefijos para los
navegadores soportados (Safari 16 en adelante), así que no se escriben `-webkit-` a mano.
`npm run contrast --prefix front` comprueba que todo el texto cumple el contraste WCAG AA en
los dos temas; el build no sigue si falla.
