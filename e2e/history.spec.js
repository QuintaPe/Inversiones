// Resumen con histórico: las pruebas corren sin cotizaciones, así que la serie diaria se simula
// para poder comprobar la gráfica de valor, la comparación con índices y el índice propio.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount, overflow } from './helpers.js';

const N = 300;
const day = (i) => new Date(Date.now() - (N - 1 - i) * 86400000).toISOString().slice(0, 10);
const series = (f) => Array.from({ length: N }, (_, i) => +f(i).toFixed(2));
const HISTORY = {
  d: Array.from({ length: N }, (_, i) => day(i)),
  v: series((i) => 30000 + i * 40 + 900 * Math.sin(i / 9)),
  cost: series((i) => 30000 + Math.floor(i / 30) * 1000),
  idx: series((i) => 100 + i * 0.02 + 2 * Math.sin(i / 9)),
  buy: series((i) => (i === 0 ? 30000 : i % 30 === 0 ? 1000 : 0)),
  sell: series(() => 0), div: series(() => 0), splits: 0, unpriced: [],
  benchmarks: [
    { key: 'world', name: 'MSCI World', c: series((i) => 80 + i * 0.03) },
    { key: 'sp500', name: 'S&P 500', c: series((i) => 500 + i * 0.3) },
    { key: 'bonds', name: 'Bonos globales', c: series((i) => 5 - i * 0.0005) },
  ],
};

async function withHistory(browser, testInfo) {
  const page = await ownAccount(browser, testInfo, { prices: true });
  await page.route('**/api/portfolio', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    await route.fulfill({ response: res, json: { ...body, meta: { ...body.meta, history: true } } });
  });
  await page.route('**/api/history', (route) => route.fulfill({ json: { history: HISTORY } }));
  return page;
}

test('resumen con histórico: rentabilidad del periodo, índices y arrastrar un tramo', async ({ browser }, testInfo) => {
  const page = await withHistory(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/resumen?periodo=max');
  await settled(page);
  await expect(page.locator('.kpi', { hasText: 'Frente al MSCI World' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Rentabilidad/ })).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  const svg = page.locator('.chart-block .chart svg').first();
  const box = await svg.boundingBox();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 5 });
  await expect(page.locator('.chart-block .tip')).toContainText(/→.*de .*€ a .*€.*invertiste/s);
  await page.mouse.up();
  expect(errors).toEqual([]);
  await page.context().close();
});

test('índice de referencia propio: se mezcla, pasa a ser la comparación y se puede quitar', async ({ browser }, testInfo) => {
  const page = await withHistory(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/resumen?periodo=max');
  await settled(page);
  await page.getByRole('button', { name: /Ver detalle/ }).click();
  await expect(page.locator('table.cmp tbody tr')).toHaveCount(4); // tu cartera y tres índices
  await page.getByRole('button', { name: 'Elegir tu índice de referencia' }).click();
  await page.getByLabel('MSCI World (%)').fill('80');
  await expect(page.getByText(/tiene que ser 100/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeDisabled();
  await page.getByLabel('Bonos globales (%)').fill('20');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('table.cmp tbody tr')).toHaveCount(5);
  await expect(page.locator('table.cmp tbody tr').nth(1)).toContainText('Tu índice');
  await expect(page.locator('table.cmp tbody tr').nth(1)).toContainText('80 % MSCI World + 20 % Bonos globales');
  await expect(page.locator('.kpi', { hasText: 'Frente a tu índice' })).toBeVisible();
  if (process.env.SHOT) await page.screenshot({ path: `${process.env.SHOT}/hist-${testInfo.project.name}.png`, fullPage: true, animations: 'disabled' });

  // Está en la cuenta: sigue tras recargar. Y se quita.
  await page.reload();
  await settled(page);
  await expect(page.locator('.kpi', { hasText: 'Frente a tu índice' })).toBeVisible();
  await page.getByRole('button', { name: /Ver detalle/ }).click();
  await page.getByRole('button', { name: 'Cambiar tu índice de referencia' }).click();
  await expect(page.getByLabel('MSCI World (%)')).toHaveValue('80');
  await page.getByRole('button', { name: 'Quitar mi índice' }).click();
  await expect(page.locator('.kpi', { hasText: 'Frente al MSCI World' })).toBeVisible();
  await expect(page.locator('table.cmp tbody tr')).toHaveCount(4);
  expect(errors).toEqual([]);
  await page.context().close();
});
