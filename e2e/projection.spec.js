// Proyección del resumen: escenarios y meta.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, overflow } from './helpers.js';

test('proyección: cambia con la aportación y dice cuándo se alcanza la meta', async ({ page }) => {
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
  // Lo escrito se conserva al recargar.
  await page.reload();
  await settled(page);
  await expect(page.getByLabel('Aportación al mes (€)')).toHaveValue('2000');
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
