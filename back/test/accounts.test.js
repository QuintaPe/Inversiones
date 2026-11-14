import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';

async function start() {
  const db = await openDb({ url: ':memory:' });
  const server = createApp({ db, verifyGoogle: null, googleClientId: null, sessionSecret: 's', slowMs: 0 }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = () => {
    let cookie = '';
    return async (p, opts = {}) => {
      const res = await fetch(base + p, { ...opts, headers: { ...opts.headers, cookie } });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      return { status: res.status, body: await res.json().catch(() => null) };
    };
  };
  return { db, server, client };
}
const json = (method, body) => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const file = (text) => { const fd = new FormData(); fd.append('file', new Blob([text]), 'cartera.json'); return { method: 'POST', body: fd }; };

test('patrimonio: cuentas con saldos fechados, validación y aislamiento entre usuarios', async () => {
  const { db, server, client } = await start();
  const a = client(), b = client();
  await a('/api/auth/demo', { method: 'POST' });
  await b('/api/auth/demo', { method: 'POST' });
  assert.deepEqual((await a('/api/accounts')).body, { accounts: [] });

  for (const bad of [{ name: '', kind: 'cash', amount: 1 }, { name: 'x', kind: 'yate', amount: 1 }, { name: 'x', kind: 'cash', amount: -1 },
    { name: 'x', kind: 'cash', amount: 'abc' }, { name: 'x', kind: 'cash', amount: 1, d: '2999-01-01' }, { name: 'x'.repeat(61), kind: 'cash', amount: 1 }]) {
    assert.equal((await a('/api/accounts', json('POST', bad))).status, 400, JSON.stringify(bad));
  }
  let r = await a('/api/accounts', json('POST', { name: ' Piso ', kind: 'property', amount: '180000,50', d: '2025-01-01' }));
  assert.equal(r.status, 200);
  const piso = r.body.accounts[0];
  assert.equal(piso.name, 'Piso');
  assert.deepEqual(piso.balances, [{ d: '2025-01-01', amount: 180000.5 }]);
  r = await a('/api/accounts', json('POST', { name: 'Hipoteca', kind: 'debt', amount: 90000 }));
  const debt = r.body.accounts.find((x) => x.kind === 'debt');
  assert.equal(debt.balances[0].d, new Date().toISOString().slice(0, 10));

  // Otro saldo, corregir el del mismo día y quitar uno.
  await a(`/api/accounts/${piso.id}/balances`, json('PUT', { amount: 185000, d: '2025-06-01' }));
  r = await a(`/api/accounts/${piso.id}/balances`, json('PUT', { amount: 186000, d: '2025-06-01' }));
  assert.deepEqual(r.body.accounts[0].balances, [{ d: '2025-01-01', amount: 180000.5 }, { d: '2025-06-01', amount: 186000 }]);
  r = await a(`/api/accounts/${piso.id}/balances/2025-01-01`, { method: 'DELETE' });
  assert.deepEqual(r.body.accounts[0].balances, [{ d: '2025-06-01', amount: 186000 }]);
  assert.equal((await a(`/api/accounts/${piso.id}/balances/ayer`, { method: 'DELETE' })).status, 400);
  r = await a(`/api/accounts/${piso.id}`, json('PUT', { name: 'Piso Madrid', kind: 'property' }));
  assert.equal(r.body.accounts[0].name, 'Piso Madrid');

  // Otro usuario ni las ve ni las toca.
  assert.deepEqual((await b('/api/accounts')).body, { accounts: [] });
  assert.equal((await b(`/api/accounts/${piso.id}`, json('PUT', { name: 'Mío', kind: 'cash' }))).status, 404);
  assert.equal((await b(`/api/accounts/${piso.id}/balances`, json('PUT', { amount: 1 }))).status, 404);
  await b(`/api/accounts/${piso.id}`, { method: 'DELETE' });
  await b(`/api/accounts/${piso.id}/balances/2025-06-01`, { method: 'DELETE' });
  assert.equal((await a('/api/accounts')).body.accounts.length, 2);
  assert.equal((await a('/api/accounts/no-es-un-id', { method: 'DELETE' })).status, 400);

  // La copia las lleva y al restaurar vuelven, también en otra cuenta de usuario.
  const text = await (await fetch(`http://127.0.0.1:${server.address().port}/api/export`, { headers: { cookie: '' } })).text();
  assert.match(text, /Inicia sesión/);
  const exported = await a('/api/export');
  assert.equal(exported.body.version, 3);
  assert.deepEqual(exported.body.accounts.map((x) => [x.name, x.kind, x.balances.length]), [['Piso Madrid', 'property', 1], ['Hipoteca', 'debt', 1]]);
  assert.equal('id' in exported.body.accounts[0], false);
  await a(`/api/accounts/${debt.id}`, { method: 'DELETE' });
  assert.equal((await a('/api/accounts')).body.accounts.length, 1);
  assert.equal((await a('/api/import', file(JSON.stringify(exported.body)))).status, 200);
  const back = (await a('/api/accounts')).body.accounts;
  assert.deepEqual(back.map((x) => [x.name, x.kind, x.balances]), [['Piso Madrid', 'property', [{ d: '2025-06-01', amount: 186000 }]], ['Hipoteca', 'debt', debt.balances]]);
  assert.equal((await b('/api/import', file(JSON.stringify(exported.body)))).status, 200);
  assert.equal((await b('/api/accounts')).body.accounts.length, 2);
  assert.equal((await a('/api/accounts')).body.accounts.length, 2);

  // Borrar los datos se las lleva.
  await a('/api/data', { method: 'DELETE' });
  assert.deepEqual((await a('/api/accounts')).body, { accounts: [] });
  assert.equal((await b('/api/accounts')).body.accounts.length, 2);
  server.close();
  await db.close();
});

test('ajustes: el plan de la proyección se valida, se guarda en la cuenta, viaja con la cartera y con la copia', async () => {
  const { db, server, client } = await start();
  const a = client(), b = client();
  await a('/api/auth/demo', { method: 'POST' });
  await b('/api/auth/demo', { method: 'POST' });
  assert.deepEqual((await a('/api/portfolio')).body.settings, {});
  const today = new Date().toISOString().slice(0, 10);

  assert.equal((await a('/api/settings/otra', json('PUT', { value: 1 }))).status, 400);
  for (const bad of [5, [], { rate: 99 }, { years: 0 }, { monthly: -1 }, { since: '2999-01-01', start: 1 }, { since: today }, { start: 5 }, { goal: 'mucho' }]) {
    assert.equal((await a('/api/settings/plan', json('PUT', { value: bad }))).status, 400, JSON.stringify(bad));
  }
  let r = await a('/api/settings/plan', json('PUT', { value: { monthly: '500,5', rate: 6, years: 20, goal: '', since: today, start: 41000, extra: 'x' } }));
  assert.equal(r.status, 200);
  const plan = { monthly: 500.5, rate: 6, years: 20, goal: null, start: 41000, since: today };
  assert.deepEqual(r.body.settings, { plan });
  assert.deepEqual((await a('/api/portfolio')).body.settings, { plan });
  assert.deepEqual((await b('/api/portfolio')).body.settings, {});

  // Índice de referencia propio: índices conocidos, sin repetir y sumando 100.
  for (const bad of [{ parts: [] }, { parts: [{ key: 'world', w: 50 }] }, { parts: [{ key: 'nasdaq', w: 100 }] }, { parts: [{ key: 'world', w: 50 }, { key: 'world', w: 50 }] }, { parts: 'world' }]) {
    assert.equal((await a('/api/settings/benchmark', json('PUT', { value: bad }))).status, 400, JSON.stringify(bad));
  }
  r = await a('/api/settings/benchmark', json('PUT', { value: { parts: [{ key: 'world', w: 80 }, { key: 'bonds', w: '20' }] } }));
  assert.deepEqual(r.body.settings.benchmark, { parts: [{ key: 'world', w: 80 }, { key: 'bonds', w: 20 }] });
  await a('/api/settings/benchmark', json('PUT', { value: null }));
  const exported = (await a('/api/export')).body;
  assert.deepEqual(exported.settings, [{ key: 'plan', value: plan }]);
  r = await a('/api/settings/plan', json('PUT', { value: null }));
  assert.deepEqual(r.body.settings, {});
  // Al restaurar vuelve; lo que no encaja en la copia se descarta.
  exported.settings.push({ key: 'plan2', value: 1 }, { key: 'plan', value: { rate: 500 } });
  assert.equal((await a('/api/import', file(JSON.stringify(exported)))).status, 200);
  assert.deepEqual((await a('/api/portfolio')).body.settings, { plan });
  await a('/api/data', { method: 'DELETE' });
  assert.deepEqual((await a('/api/portfolio')).body.settings, {});
  server.close();
  await db.close();
});
