import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuotes } from '../src/quotes.js';

const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => body });
const fail = (status, headers = {}) => ({ ok: false, status, headers: { get: (k) => headers[k] ?? null } });
const chart = (meta, extra = {}) => ok({ chart: { result: [{ meta, ...extra }] } });
const quiet = { warn() {}, error() {}, log() {} };
/** Servicio con respuestas de mentira; `sleeps` recoge las esperas sin esperar de verdad. */
function setup(handler, { t = { now: 1_800_000_000_000 } } = {}) {
  const calls = [], sleeps = [], warnings = [];
  const q = createQuotes({
    fetchImpl: async (url, opts) => { calls.push(url); return handler(url, opts, calls.length); },
    now: () => t.now, sleep: async (ms) => { sleeps.push(ms); },
    log: { ...quiet, warn: (m) => warnings.push(m) },
  });
  return { q, calls, sleeps, warnings, t };
}
const SYM = { US0378331005: { symbol: 'AAPL', exchange: 'NASDAQ' }, GB0000000001: { symbol: 'VOD.L', exchange: 'LSE' }, DE0000000001: { symbol: 'SAP.DE', exchange: 'XETRA' } };

test('cotización: pasa a euros, calcula la variación del día y convierte los peniques de Londres', async () => {
  const { q } = setup((url) => {
    if (url.includes('/AAPL?')) return chart({ regularMarketPrice: 200, chartPreviousClose: 160, currency: 'USD', regularMarketTime: 1_800_000_000, fullExchangeName: 'NasdaqGS' });
    if (url.includes('/USDEUR%3DX?')) return chart({ regularMarketPrice: 0.9, currency: 'EUR' });
    if (url.includes('/VOD.L?')) return chart({ regularMarketPrice: 250, previousClose: 250, currency: 'GBp' });
    if (url.includes('/GBPEUR%3DX?')) return chart({ regularMarketPrice: 1.2, currency: 'EUR' });
    throw new Error(`inesperado: ${url}`);
  });
  const r = await q.quoteIsins(['US0378331005', 'GB0000000001', 'no-es-un-isin'], SYM);
  assert.deepEqual(r.failed, []);
  const a = r.quotes.US0378331005;
  assert.equal(a.price, 180);
  assert.deepEqual([a.info.symbol, a.info.currency, a.info.raw, a.info.rate, a.info.exchange], ['AAPL', 'USD', 200, 0.9, 'NasdaqGS']);
  assert.ok(Math.abs(a.info.dayPct - 25) < 1e-9);
  assert.equal(a.info.time, new Date(1_800_000_000_000).toISOString());
  assert.ok(Math.abs(r.quotes.GB0000000001.price - 3) < 1e-9); // 250 peniques = 2,5 £ × 1,2
  assert.equal(r.quotes.GB0000000001.info.currency, 'GBP');
});

test('fallo pasajero: se reintenta con espera creciente y respeta Retry-After', async () => {
  const { q, calls, sleeps } = setup((url, _o, n) => {
    if (n === 1) throw new TypeError('fetch failed');
    if (n === 2) return fail(429, { 'retry-after': '2' });
    return chart({ regularMarketPrice: 100, currency: 'EUR' });
  });
  const r = await q.quoteIsins(['DE0000000001'], SYM);
  assert.equal(r.quotes.DE0000000001.price, 100);
  assert.equal(calls.length, 3);
  assert.deepEqual(sleeps.filter((ms) => ms !== 120), [400, 2000]);
});

test('un 404 no se reintenta ni cuenta como caída del proveedor', async () => {
  const { q, calls, warnings } = setup(() => fail(404));
  for (let i = 0; i < 6; i++) assert.deepEqual((await q.quoteIsins(['DE0000000001'], SYM)).failed, ['DE0000000001']);
  assert.equal(calls.length, 6);
  assert.deepEqual(q.paused(), {});
  assert.equal(warnings.length, 0);
});

test('proveedor caído: tras varios fallos seguidos se deja de llamar un rato y luego se vuelve a probar', async () => {
  let up = false;
  const { q, calls, warnings, t } = setup(() => (up ? chart({ regularMarketPrice: 50, currency: 'EUR' }) : fail(503)));
  for (let i = 0; i < 4; i++) await q.quoteIsins(['DE0000000001'], SYM);
  assert.equal(calls.length, 12); // 4 intentos × (1 + 2 reintentos)
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /query1\.finance\.yahoo\.com lleva 4 fallos seguidos/);
  assert.ok(q.paused()['query1.finance.yahoo.com'] > 0);

  // En pausa: falla enseguida, sin tocar la red.
  assert.deepEqual((await q.quoteIsins(['DE0000000001'], SYM)).failed, ['DE0000000001']);
  assert.equal(calls.length, 12);

  // Pasada la pausa se prueba otra vez; si sigue caído, la pausa siguiente dura el doble.
  t.now += 61_000;
  await q.quoteIsins(['DE0000000001'], SYM);
  assert.equal(calls.length, 15);
  assert.ok(q.paused()['query1.finance.yahoo.com'] > 100_000);

  t.now += 121_000;
  up = true;
  assert.equal((await q.quoteIsins(['DE0000000001'], SYM)).quotes.DE0000000001.price, 50);
  assert.deepEqual(q.paused(), {});
});

test('divisa: si Yahoo no da el cambio se usa el tipo de referencia del BCE', async () => {
  const xml = "<Cube><Cube time='2026-11-13'><Cube currency='USD' rate='1.2500'/><Cube currency='JPY' rate='160.0'/></Cube></Cube>";
  const { q, calls } = setup((url) => {
    if (url.includes('/AAPL?')) return chart({ regularMarketPrice: 200, currency: 'USD' });
    if (url.includes('USDEUR')) return fail(404);
    if (url.includes('ecb.europa.eu')) return ok(xml);
    throw new Error(`inesperado: ${url}`);
  });
  const r = await q.quoteIsins(['US0378331005'], SYM);
  assert.equal(r.quotes.US0378331005.price, 160); // 200 $ ÷ 1,25
  assert.equal(r.quotes.US0378331005.info.rate, 0.8);
  // El BCE publica una vez al día: no se vuelve a pedir en cada cotización.
  await q.quoteIsins(['US0378331005'], SYM);
  assert.equal(calls.filter((u) => u.includes('ecb.europa.eu')).length, 1);
});

test('histórico: fechas en el día de su bolsa, peniques, dividendos y splits ordenados', async () => {
  const day = (d) => Date.parse(`${d}T00:00:00Z`) / 1000;
  const { q, calls } = setup(() => chart(
    { currency: 'GBp', gmtoffset: 3600 },
    {
      timestamp: [day('2025-01-02') - 1800, day('2025-01-03') + 8 * 3600, day('2025-01-06') + 8 * 3600],
      indicators: { quote: [{ close: [100, null, 110] }] },
      events: {
        dividends: { a: { date: day('2025-01-03') + 8 * 3600, amount: 5 } },
        splits: { b: { date: day('2025-01-06'), numerator: 4, denominator: 1 }, c: { date: day('2025-01-02'), numerator: 1, denominator: 10 }, d: { date: day('2025-01-05'), numerator: 1, denominator: 1 } },
      },
    },
  ));
  const h = await q.history('VOD.L', '2025-01-01');
  assert.equal(h.currency, 'GBP');
  assert.deepEqual(h.rows, [['2025-01-02', 1], ['2025-01-06', 1.1]]); // 23:30 UTC ya es el día 2 en su bolsa; sin cierre no hay punto
  assert.deepEqual(h.divs, [['2025-01-03', 0.05]]);
  assert.deepEqual(h.splits, [['2025-01-02', 0.1], ['2025-01-06', 4]]);
  assert.match(calls[0], /period1=\d+&period2=\d+&events=div%2Csplits/);
  await assert.rejects(setup(() => ok({ chart: { result: null } })).q.history('NADA', '2025-01-01'), /sin histórico/);
});

test('una descarga de histórico lenta no hace esperar a la cotización del momento', async () => {
  let release;
  const slow = new Promise((r) => { release = r; });
  const { q, calls } = setup(async (url) => {
    if (url.includes('period1=')) {
      await slow; // el histórico se queda colgado hasta que se suelta
      return chart({ currency: 'EUR' }, { timestamp: [1_800_000_000], indicators: { quote: [{ close: [10] }], adjclose: [{ adjclose: [10] }] } });
    }
    if (url.includes('/SAP.DE?')) return chart({ regularMarketPrice: 150, chartPreviousClose: 150, currency: 'EUR' });
    throw new Error(`inesperado: ${url}`);
  });
  const hist = q.history('SAP.DE', '2020-01-01');
  const r = await q.quoteIsins(['DE0000000001'], SYM); // no espera al histórico
  assert.equal(r.quotes.DE0000000001.price, 150);
  assert.equal(calls.filter((u) => u.includes('period1=')).length, 1);
  release();
  await hist;
});

// Ficha de Quefondos de un plan de pensiones (lo esencial de su maquetación).
const planHtml = (vl, fecha, serie = '') => `<html><head><title>MYINVESTOR INDEXADO GLOBAL (N5396) · MERCHBANC - Informe</title></head><body>
  <span class="floatleft">Valor liquidativo: </span><span class="floatright">${vl} EUR</span>
  <span class="floatleft">Fecha: </span><span class="floatright">${fecha}</span>
  ${serie && `<script>\n\t\t\tvar fondo = ${serie};\n\t\t\tvar categoria = [["11/30/2016",1199.03]];\n</script>`}</body></html>`;

test('plan de pensiones: código de la DGSFP → valor liquidativo y fecha de Quefondos, en euros', async () => {
  const { q, calls } = setup((url) => {
    if (url.includes('quefondos.com') && url.includes('isin=N5396')) return ok(planHtml('19,607890', '19/11/2026'));
    throw new Error(`inesperado: ${url}`);
  });
  const r = await q.quoteIsins(['N5396'], {});
  assert.deepEqual(r.failed, []);
  assert.deepEqual(r.resolved.N5396, { symbol: 'PLAN:N5396', exchange: 'Valor liquidativo', sector: null, industry: null });
  const x = r.quotes.N5396;
  assert.equal(x.price, 19.60789);
  assert.equal(x.info.time, '2026-11-19T00:00:00.000Z');
  assert.equal(x.info.name, 'MYINVESTOR INDEXADO GLOBAL');
  assert.equal(x.info.plan, true);
  assert.ok(calls.every((u) => u.includes('quefondos.com')), 'ni Yahoo ni OpenFIGI');
  // El histórico es el último valor publicado: un punto por descarga.
  const h = await q.history('PLAN:N5396', '2025-12-12');
  assert.deepEqual(h.rows, [['2026-11-19', 19.60789]]);
});

test('plan de pensiones: si la ficha cambia y no trae el valor, falla sin inventar un precio', async () => {
  const { q } = setup(() => ok('<html><body>Página en mantenimiento</body></html>'));
  const r = await q.quoteIsins(['N5396'], { N5396: { symbol: 'PLAN:N5396', exchange: 'Valor liquidativo' } });
  assert.deepEqual(r.failed, ['N5396']);
  assert.equal(r.quotes.N5396, undefined);
});


test('plan de pensiones: el histórico son los fines de mes de la gráfica de Quefondos más el último valor', async () => {
  const serie = '[["10/31/2025",17.1],["11/30/2025",17.32],["12/31/2025",17.38],["01/31/2026",17.58],["11/19/2026",22.0]]';
  const { q } = setup((url) => {
    if (url.includes('quefondos.com')) return ok(planHtml('22,000000', '19/11/2026', serie));
    throw new Error(`inesperado: ${url}`);
  });
  const h = await q.history('PLAN:N5396', '2025-12-12');
  // Desde un mes antes de la compra (el 31/10/2025 queda fuera); el último, una sola vez.
  assert.deepEqual(h.rows, [['2025-11-30', 17.32], ['2025-12-31', 17.38], ['2026-01-31', 17.58], ['2026-11-19', 22]]);
});

test('plan de pensiones: sin la gráfica en la ficha, el histórico es solo el valor del día', async () => {
  const { q } = setup(() => ok(planHtml('22,000000', '19/11/2026')));
  const h = await q.history('PLAN:N5396', '2025-12-12');
  assert.deepEqual(h.rows, [['2026-11-19', 22]]);
});
