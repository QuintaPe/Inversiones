// Proyección del resumen: escenarios y meta.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, overflow, ownAccount } from './helpers.js';

// El plan se guarda en la cuenta: cada configuración usa la suya para no pisarse.
test('proyección: cambia con la aportación y dice cuándo se alcanza la meta', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo, { prices: true });
  const errors = watchErrors(page);
  await page.goto('/resumen');
  await settled(page);
  const card = page.locator('.card', { hasText: 'Proyección' }).last();
  await card.scrollIntoViewIfNeeded();
  await expect(card.getByRole('group', { name: /Proyección a futuro/ }).or(card.locator('.chart'))).toBeVisible();
  const total = card.locator('.proj-s .stat-v').first();
  const before = await total.textContent();
  await card.getByLabel('Aportación al mes (€)').fill('2000');
  await expect(total).not.toHaveText(before);
  await card.getByLabel('Meta (€, opcional)').fill('100000');
  await expect(card.locator('.proj-g')).toContainText(/Alcanzas .*100\.000,00.* en \w+ de 20\d\d/);
  await card.getByLabel('Meta (€, opcional)').fill('99999999');
  await expect(card.locator('.proj-g')).toContainText('no llegas');
  // Al salir del campo se guarda en la cuenta.
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/settings/plan') && r.ok());
  await page.keyboard.press('Tab');
  await saved;
  // Lo escrito se conserva al recargar.
  await page.reload();
  await settled(page);
  await expect(page.getByLabel('Aportación al mes (€)')).toHaveValue('2000');
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Está en la cuenta, no solo en este navegador: sigue ahí tras borrar lo guardado en él.
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await settled(page);
  await expect(page.getByLabel('Aportación al mes (€)')).toHaveValue('2000');
  await expect(page.getByLabel('Meta (€, opcional)')).toHaveValue('99999999');

  // Plan frente a realidad: se fija hoy y se puede dejar de medir.
  const card2 = page.locator('.card', { hasText: 'Proyección' }).last();
  await card2.getByRole('button', { name: 'Seguir este plan desde hoy' }).click();
  await expect(card2.locator('.proj-t')).toContainText('Plan fijado el');
  await page.reload();
  await settled(page);
  await expect(page.locator('.proj-t')).toContainText('Plan fijado el');
  await page.getByRole('button', { name: 'Dejar de medir' }).click();
  await expect(page.getByRole('button', { name: 'Seguir este plan desde hoy' })).toBeVisible();
  expect(errors).toEqual([]);
  await page.context().close();
});
