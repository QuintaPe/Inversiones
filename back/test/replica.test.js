import test from 'node:test';
import assert from 'node:assert/strict';
import { readsOneByOne } from '../src/db.js';

test('réplica: los lotes de lectura van consulta a consulta (fichero local) y los de escritura, en lote', async () => {
  const calls = [];
  const client = readsOneByOne({
    execute: async (st) => { calls.push(['execute', st.sql]); return { rows: [{ sql: st.sql }] }; },
    batch: async (stmts, mode) => { calls.push(['batch', mode, stmts.length]); return stmts.map(() => ({ rows: [] })); },
  });
  const r = await client.batch([{ sql: 'SELECT 1' }, { sql: 'SELECT 2' }], 'read');
  assert.deepEqual(r.map((x) => x.rows[0].sql), ['SELECT 1', 'SELECT 2'], 'mismo orden y forma que un lote');
  await client.batch([{ sql: 'INSERT 1' }, { sql: 'INSERT 2' }], 'write');
  assert.deepEqual(calls, [['execute', 'SELECT 1'], ['execute', 'SELECT 2'], ['batch', 'write', 2]]);
});
