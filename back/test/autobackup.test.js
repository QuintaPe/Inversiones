import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { openDb } from '../src/db.js';
import { createAutoBackup, keepDays } from '../src/autobackup.js';
import { readBackup } from '../src/backup.js';
import { manualRow } from '../src/engine.js';

const day = (n) => new Date(Date.UTC(2026, 0, 1) + n * 86400000).toISOString().slice(0, 10);

test('copias que se conservan: las últimas diarias y una por semana de las anteriores', () => {
  const days = Array.from({ length: 120 }, (_, i) => day(i));
  const keep = keepDays(days, 14, 8);
  assert.equal(keep.size, 22);
  for (const d of days.slice(-14)) assert.ok(keep.has(d), d);
  const older = [...keep].filter((d) => d < days.at(-14)).sort();
  assert.equal(older.length, 8);
  // Una por semana: entre dos seguidas hay siete días (salvo la semana partida por el corte).
  for (let i = 1; i < older.length - 1; i++) assert.equal((Date.parse(older[i]) - Date.parse(older[i - 1])) / 86400000, 7);
  assert.deepEqual([...keepDays(['2026-01-02', '2026-01-01'], 14, 8)].sort(), ['2026-01-01', '2026-01-02']);
});

test('copia automática: un archivo por cuenta real, restaurable, y limpieza de las antiguas', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cartera-copias-'));
  try {
    const db = await openDb({ url: ':memory:' });
    await db.upsertUser({ id: 'u1', email: 'a@b.c', name: 'A' });
    await db.upsertUser({ id: 'vacia', email: 'v@b.c', name: 'V' });
    await db.upsertUser({ id: 'demo-x', email: 'd@b.c', name: 'D' });
    const row = manualRow({ type: 'BUY', isin: 'US0378331005', name: 'Apple', date: '2026-01-05', shares: 2, price: 100, fee: 1, tax: 0, amount: 0 }, 'manual-1');
    await db.putRow('u1', row);
    await db.putRow('demo-x', row);

    await fs.mkdir(path.join(dir, '2020-01-01'));
    await fs.mkdir(path.join(dir, 'otra-cosa'));
    let t = Date.parse('2026-03-10T08:00:00Z');
    const backups = createAutoBackup({ db, dir, daily: 1, weekly: 0, now: () => t });
    assert.equal(backups.last(), null);
    assert.equal(await backups.due(), true);
    assert.deepEqual(await backups.run(), { at: '2026-03-10T08:00:00.000Z', day: '2026-03-10', users: 1 });
    assert.deepEqual(await fs.readdir(path.join(dir, '2026-03-10')), ['u1.json.gz']);
    assert.equal(await backups.due(), false);
    // Lo que no es una carpeta de día no se toca; la copia vieja sí se quita.
    assert.deepEqual((await fs.readdir(dir)).sort(), ['2026-03-10', 'otra-cosa']);

    const text = zlib.gunzipSync(await fs.readFile(path.join(dir, '2026-03-10', 'u1.json.gz'))).toString('utf8');
    const b = readBackup(text);
    assert.equal(b.transactions.length, 1);
    assert.equal(b.transactions[0].transaction_id, 'manual-1');
    assert.equal(b.transactions[0].source, 'manual');

    t += 86400000;
    await backups.run();
    assert.deepEqual((await fs.readdir(dir)).sort(), ['2026-03-11', 'otra-cosa']);
    assert.equal(backups.last().error, null);
    await db.close();
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
