// Patrimonio (Efectivo → Patrimonio): cuentas, bienes y deudas anotados a mano.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount, overflow } from './helpers.js';

test('patrimonio: se añaden un bien y una deuda, se actualiza un saldo y se quita', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/efectivo?ver=patrimonio');
  await settled(page);
  const card = (label) => page.locator('.kpi', { has: page.locator('.kpi-l', { hasText: new RegExp(`^${label}$`) }) });
  const kpi = (label) => card(label).locator('.kpi-v');
  await expect(kpi('Patrimonio neto')).toBeVisible();
  await expect(card('Debes')).toHaveCount(0);
  const before = await kpi('Tienes').textContent();

  await page.getByLabel('Nombre').fill('Piso');
  await page.getByLabel('Tipo').selectOption('property');
  await page.getByLabel('Saldo o valor (€)').fill('200000');
  await page.getByRole('button', { name: 'Añadir' }).click();
  await expect(page.locator('.acct', { hasText: 'Piso' }).locator('.acct-v')).toHaveText(/200\.000,00/);
  await expect(kpi('Tienes')).not.toHaveText(before);

  await page.getByLabel('Nombre').fill('Hipoteca');
  await page.getByLabel('Tipo').selectOption('debt');
  await page.getByLabel('Lo que debes (€)').fill('90000');
  await page.getByRole('button', { name: 'Añadir' }).click();
  await expect(kpi('Debes')).toHaveText(/90\.000,00/);
  await expect(page.locator('.acct', { hasText: 'Hipoteca' }).locator('.acct-v')).toHaveText(/−90\.000,00/);

  // Actualizar el saldo de la deuda (el mismo día corrige el anterior).
  const debt = page.locator('.acct', { hasText: 'Hipoteca' });
  await debt.getByRole('button', { name: 'Actualizar' }).click();
  await debt.getByLabel('Saldo de Hipoteca en euros').fill('88500,5');
  await debt.getByRole('button', { name: 'Anotar' }).click();
  await expect(kpi('Debes')).toHaveText(/88\.500,50/);

  // Sigue ahí al recargar, y sin desbordes.
  await page.reload();
  await settled(page);
  await expect(page.locator('.acct')).toHaveCount(2);
  expect(await overflow(page)).toBeLessThanOrEqual(0);

  // Quitar pide confirmación.
  const debt2 = page.locator('.acct', { hasText: 'Hipoteca' });
  await debt2.getByRole('button', { name: 'Actualizar' }).click();
  await debt2.getByRole('button', { name: 'Quitar del patrimonio' }).click();
  await debt2.getByRole('button', { name: 'Quitar Hipoteca' }).click();
  await expect(page.locator('.acct')).toHaveCount(1);
  await expect(card('Debes')).toHaveCount(0);
  expect(errors).toEqual([]);
  await page.context().close();
});
