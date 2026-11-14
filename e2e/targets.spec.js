// Posiciones → Cartera objetivo: el ajuste y lo que costaría en impuestos.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount, overflow } from './helpers.js';

test('cartera objetivo: a partes iguales propone ventas, dice su coste fiscal y lleva al simulador', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo, { prices: true });
  const errors = watchErrors(page);
  await page.goto('/posiciones?ver=objetivo');
  await settled(page);
  await expect(page.locator('.callout')).toHaveCount(0);
  await page.getByRole('button', { name: 'Repartir a partes iguales' }).click();
  await expect(page.locator('.tgt-do', { hasText: 'Vender' }).first()).toBeVisible();
  const note = page.locator('.callout', { hasText: 'Vender lo que propone el ajuste' });
  await expect(note).toContainText(/afloraría .*€/);
  // Con una aportación que cubre todo lo que falta ya no hay ventas ni aviso.
  await page.getByLabel('Aportación nueva (€)').fill('500000');
  await expect(note).toHaveCount(0);
  await page.getByLabel('Aportación nueva (€)').fill('');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  await note.getByRole('link', { name: 'Abrir el simulador de ventas' }).click();
  await expect(page).toHaveURL(/\/fiscalidad\?ver=simular$/);
  await expect(page.getByText('Qué venderías hoy')).toBeVisible();
  expect(errors).toEqual([]);
  await page.context().close();
});
