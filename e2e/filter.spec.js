// Resumen filtrado por tipo de activo: la variación del periodo y la gráfica salen de las series
// de ese tipo (history.groups), como con «Todo».
import { test, expect } from '@playwright/test';
import { settled } from './helpers.js';

const DAY = 86400000;
const noDates = ({ d, ...rest }) => rest; // el servidor manda las fechas una sola vez
function series(n, v0, step) {
  const d = [], v = [], cost = [], idx = [], buy = [], sell = [], div = [];
  const t0 = Date.UTC(new Date().getUTCFullYear() - 1, 0, 1);
  for (let i = 0; i < n; i++) {
    d.push(new Date(t0 + i * DAY).toISOString().slice(0, 10));
    v.push(+(v0 + step * i).toFixed(2)); cost.push(v0); idx.push(+(100 * (1 + (step * i) / v0)).toFixed(4));
    buy.push(i === 0 ? v0 : 0); sell.push(0); div.push(0);
  }
  return { d, v, cost, idx, buy, sell, div };
}

test('con «Acciones y ETF» el resumen muestra la variación del periodo', async ({ page }) => {
  const n = Math.round((Date.now() - Date.UTC(new Date().getUTCFullYear() - 1, 0, 1)) / DAY) + 1;
  const ac = series(n, 1000, 1), pm = series(n, 500, 0.2);
  const all = { ...ac, v: ac.v.map((x, i) => +(x + pm.v[i]).toFixed(2)), cost: ac.cost.map((x, i) => x + pm.cost[i]), buy: ac.buy.map((x, i) => x + pm.buy[i]) };
  await page.route('**/api/portfolio', async (r) => {
    const res = await r.fetch(); const j = await res.json();
    // Como Private Markets, valores de la cartera de ejemplo que no reparten dividendos.
    const PM = ['IE00B4L5Y983', 'IE00BK5BQT80', 'US67066G1040', 'NL0010273215'];
    j.positions.forEach((p) => { p.grp = PM.includes(p.isin) ? 'pm' : 'ac'; });
    j.meta.history = true;
    await r.fulfill({ response: res, json: j });
  });
  await page.route('**/api/history', (r) => r.fulfill({ json: { history: { ...all, benchmarks: [], unpriced: [], splits: 0, groups: { ac: noDates(ac), pm: noDates(pm) } } } }));

  await page.goto('/resumen');
  await settled(page);
  const hero = page.locator('.hero-dash');
  await expect(hero.getByText('este año')).toBeVisible();
  await page.getByRole('group', { name: 'Tipo de activo' }).getByRole('button', { name: 'Acciones y ETF' }).click();
  await expect(hero.getByText('este año')).toBeVisible();
  await expect(page.getByRole('group', { name: 'Valor de la cartera' })).toBeVisible();
  await expect(page.getByText(/se calculan sobre toda la cartera/)).toHaveCount(0);

  // Private Markets: sin dividendos ni efectivo (que es de toda la cuenta), no salen sus tarjetas.
  const kpis = page.locator('.kpis-fit');
  await page.getByRole('group', { name: 'Tipo de activo' }).getByRole('button', { name: 'Todo' }).click();
  await expect(kpis.getByText('Dividendos 12 meses')).toBeVisible();
  await expect(kpis.getByText('Efectivo', { exact: true })).toBeVisible();
  await page.getByRole('group', { name: 'Tipo de activo' }).getByRole('button', { name: 'Private Markets' }).click();
  await expect(kpis.getByText('Resultado total')).toBeVisible();
  await expect(kpis.getByText('Dividendos 12 meses')).toHaveCount(0);
  await expect(kpis.getByText('Efectivo', { exact: true })).toHaveCount(0);
});
