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
