import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createStream } from '../src/stream.js';

// Petición y respuesta mínimas: lo que usa connect (writeHead, write, end y el evento close).
function pair() {
  const req = new EventEmitter();
  const res = {
    ended: false, out: '',
    writeHead() {}, write(s) { this.out += s; },
    end() { this.ended = true; req.emit('close'); },
  };
  return { req, res };
}

test('con el cupo de pestañas lleno entra la nueva y se cierra la más antigua', async () => {
  let asked = null;
  const s = createStream({ refresh: async (ids) => { asked = ids; return new Map([[1, { at: 'x' }]]); } });
  const tabs = Array.from({ length: 6 }, () => pair());
  for (const { req, res } of tabs) s.connect(req, res, 1);
  assert.ok(tabs.every(({ res }) => !res.ended));

  const fresh = pair();
  s.connect(fresh.req, fresh.res, 1);
  assert.equal(tabs[0].res.ended, true, 'la más antigua se cierra');
  assert.ok(tabs.slice(1).every(({ res }) => !res.ended), 'las demás siguen');
  assert.equal(fresh.res.ended, false);

  // La nueva recibe las cotizaciones; la cerrada ya no.
  const n = await s.tick();
  assert.deepEqual(asked, [1]);
  assert.equal(n, 6);
  assert.match(fresh.res.out, /event: quotes/);
  assert.doesNotMatch(tabs[0].res.out, /event: quotes/);
  s.close();
});
