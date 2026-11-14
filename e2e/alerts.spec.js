// Ficha → Alertas: de precio, de movimiento del día y de caída desde máximos.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount, APPLE } from './helpers.js';

test('alertas: se crea una de precio y una de caída desde máximos, y se borran', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo, { prices: true });
  const errors = watchErrors(page);
  // Las alertas solo se ofrecen en valores con cotización en vivo, y las pruebas corren sin ella:
  // se marca Apple como cotizado.
  await page.route('**/api/portfolio', async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    const positions = body.positions.map((p) => (p.isin === APPLE ? { ...p, priceSource: 'live', priceInfo: { symbol: 'AAPL', dayPct: 1.2 } } : p));
    await route.fulfill({ response: res, json: { ...body, positions } });
  });
  await page.goto(`/activo/${APPLE}?ver=alertas`);
  await settled(page);
  await page.getByLabel('Precio de la alerta en euros').fill('200');
  await page.getByRole('button', { name: 'Crear' }).click();
  await expect(page.locator('.al-l li')).toHaveCount(1);
  await expect(page.locator('.al-l li').first()).toContainText(/Si baja de\s*200,00/);

  await page.getByRole('group', { name: 'Sentido de la alerta' }).getByRole('button', { name: 'Cae desde máximos' }).click();
  // Un porcentaje imposible no se envía.
  await page.getByLabel('Caída desde el máximo en porcentaje').fill('150');
  await page.getByRole('button', { name: 'Crear' }).click();
  await expect(page.locator('.al-l li')).toHaveCount(1);
  await page.getByLabel('Caída desde el máximo en porcentaje').fill('20');
  await page.getByRole('button', { name: 'Crear' }).click();
  await expect(page.locator('.al-l li')).toHaveCount(2);
  await expect(page.locator('.al-l')).toContainText(/Si cae un\s*20,00\s%\s*desde su máximo del último año/);

  await page.reload();
  await settled(page);
  await expect(page.locator('.al-l li')).toHaveCount(2);
  await page.getByRole('button', { name: 'Borrar alerta' }).first().click();
  await expect(page.locator('.al-l li')).toHaveCount(1);
  expect(errors).toEqual([]);
  await page.context().close();
});
