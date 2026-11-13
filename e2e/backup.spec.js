// Copia de los datos: se descarga desde el menú de la cuenta y se puede restaurar.
import { test, expect } from '@playwright/test';
import { watchErrors, settled } from './helpers.js';

test('restaurar una copia: enseña qué trae, avisa de que sustituye y la carga', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/posiciones');
  await settled(page);
  const dump = await (await page.request.get('/api/export')).json();
  const live = dump.transactions.filter((t) => !t.deleted_at).length;

  await page.getByRole('button', { name: 'Cuenta' }).click();
  await expect(page.getByRole('menuitem', { name: 'Restaurar una copia' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('Archivo de la copia').setInputFiles({ name: 'cartera-copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(dump)) });

  const dialog = page.getByRole('dialog', { name: 'Restaurar una copia' });
  await expect(dialog).toContainText('cartera-copia.json');
  await expect(dialog.locator('.imp li').first()).toContainText(live.toLocaleString('es-ES'));
  await expect(dialog).toContainText('sustituye todo');
  await dialog.getByRole('button', { name: 'Restaurar la copia' }).click();
  await expect(page.locator('.toast, [role=status]').filter({ hasText: 'Copia restaurada' }).first()).toBeVisible();
  await expect(page).toHaveURL(/\/resumen$/);
  expect(errors).toEqual([]);
});

test('un archivo que no es una copia se rechaza con un aviso', async ({ page }) => {
  await page.goto('/resumen');
  await settled(page);
  await page.getByLabel('Archivo de la copia').setInputFiles({ name: 'otra-cosa.json', mimeType: 'application/json', buffer: Buffer.from('{"hola":1}') });
  await expect(page.getByText('no es una copia descargada desde esta app')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Restaurar una copia' })).toHaveCount(0);
});
