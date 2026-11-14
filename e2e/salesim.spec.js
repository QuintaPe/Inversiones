// Fiscalidad → Simular: varias ventas a la vez y su efecto conjunto en la declaración.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, overflow } from './helpers.js';

test('simulador de ventas: las que pierden, añadir una ganadora, ajustar unidades y limpiar', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/fiscalidad?ver=simular');
  await settled(page);
  const result = page.locator('.ssim .card').nth(1);
  // En el móvil las pestañas se deslizan: la elegida queda entera a la vista.
  await expect(page.getByRole('tab', { name: 'Simular' })).toBeInViewport({ ratio: 1 });
  await expect(result.getByText('Marca alguna posición')).toBeVisible();

  // Microsoft e Inditex están en pérdidas en la cartera de ejemplo.
  await page.getByRole('button', { name: 'Las que pierden' }).click();
  await expect(page.getByLabel('Vender Microsoft')).toBeChecked();
  await expect(page.getByLabel('Vender Inditex')).toBeChecked();
  await expect(result.locator('.rows li')).toHaveCount(2);
  await expect(result.getByText('Te quedarías con')).toBeVisible();
  const keep = await result.locator('.sim-v').textContent();

  await page.getByLabel('Vender Apple').check();
  await expect(result.locator('.rows li')).toHaveCount(3);
  await expect(result.locator('.sim-v')).not.toHaveText(keep);
  const three = await result.locator('.sim-v').textContent();
  await page.getByLabel('Unidades de Apple a vender').fill('5');
  await expect(result.locator('.sim-v')).not.toHaveText(three);
  await expect(result.locator('.rows li', { hasText: 'Apple' })).toContainText('5 uds.');
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Limpiar' }).click();
  await expect(result.getByText('Marca alguna posición')).toBeVisible();
  await expect(page.getByLabel('Vender Apple')).not.toBeChecked();
  expect(errors).toEqual([]);
});
