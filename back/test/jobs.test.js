import test from 'node:test';
import assert from 'node:assert/strict';
import { createJobs } from '../src/jobs.js';

test('tareas programadas: no se solapan, un fallo queda apuntado y no detiene las siguientes', async () => {
  const errors = [];
  const jobs = createJobs({ log: { error: (...a) => errors.push(a.join(' ')) } });
  let n = 0, release;
  jobs.add('lenta', 3600_000, () => new Promise((ok) => { n++; release = ok; }));
  let fail = true;
  jobs.add('frágil', 3600_000, async () => { if (fail) throw new Error('sin red'); return 7; }, { atStart: true });
  assert.throws(() => jobs.add('lenta', 1000, () => {}), /repetida/);

  const first = jobs.run('lenta');
  assert.equal(await jobs.run('lenta'), undefined); // ya está en marcha
  assert.equal(n, 1);
  assert.equal(jobs.status().find((j) => j.name === 'lenta').running, true);
  release('hecho');
  assert.equal(await first, 'hecho');

  await new Promise((r) => setImmediate(r));
  let s = jobs.status().find((j) => j.name === 'frágil');
  assert.deepEqual([s.runs, s.lastError, s.everySec], [1, 'sin red', 3600]);
  assert.match(errors[0], /Tarea «frágil»: sin red/);
  fail = false;
  assert.equal(await jobs.run('frágil'), 7);
  s = jobs.status().find((j) => j.name === 'frágil');
  assert.deepEqual([s.runs, s.lastError, typeof s.lastAt, s.running], [2, null, 'string', false]);
  assert.equal(await jobs.run('no-existe'), undefined);
  jobs.stop();
  assert.deepEqual(jobs.status(), []);
});

test('tareas diarias: la próxima vez son las 6:00 de España, también al cambiar de hora', async () => {
  const { nextDaily } = await import('../src/jobs.js');
  const iso = (t) => new Date(t).toISOString();
  // Noviembre (UTC+1): a las 5:30 de Madrid toca hoy; a las 6:02, mañana.
  assert.equal(iso(nextDaily(Date.parse('2026-11-23T04:30:00Z'), 6, 'Europe/Madrid')), '2026-11-23T05:00:00.000Z');
  assert.equal(iso(nextDaily(Date.parse('2026-11-23T05:02:00Z'), 6, 'Europe/Madrid')), '2026-11-24T05:00:00.000Z');
  // Julio (UTC+2).
  assert.equal(iso(nextDaily(Date.parse('2026-07-01T10:00:00Z'), 6, 'Europe/Madrid')), '2026-07-02T04:00:00.000Z');
  // La noche del cambio a horario de verano (29/03/2026): a las 6 ya es UTC+2.
  assert.equal(iso(nextDaily(Date.parse('2026-03-28T12:00:00Z'), 6, 'Europe/Madrid')), '2026-03-29T04:00:00.000Z');
  // Y la del cambio a horario de invierno (25/10/2026): a las 6 vuelve a ser UTC+1.
  assert.equal(iso(nextDaily(Date.parse('2026-10-24T12:00:00Z'), 6, 'Europe/Madrid')), '2026-10-25T05:00:00.000Z');
});
