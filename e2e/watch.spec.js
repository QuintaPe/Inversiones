// Seguimiento de valores que no se tienen y nota de cada activo.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, ownAccount, APPLE } from './helpers.js';

test('seguimiento: se añade un valor por ISIN, se rechaza uno mal escrito y se deja de seguir', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto('/posiciones?ver=seguimiento');
  await settled(page);
  await expect(page.getByText('Todavía no sigues ningún valor.')).toBeVisible();
  await page.getByLabel('ISIN del valor').fill('DE0007164600');
  await page.getByLabel('Nombre del valor').fill('SAP');
  await page.getByRole('button', { name: 'Seguir' }).click();
  await expect(page.locator('.watch-l li')).toContainText('SAP');
  await page.reload();
  await settled(page);
  await expect(page.locator('.watch-l li')).toHaveCount(1);
  await page.getByRole('button', { name: 'Dejar de seguir SAP' }).click();
  await expect(page.getByText('Todavía no sigues ningún valor.')).toBeVisible();
  expect(errors).toEqual([]);
  // Un ISIN mal escrito: el aviso sale junto al formulario (el 400 es lo esperado).
  await page.getByLabel('ISIN del valor').fill('ABC');
  await page.getByRole('button', { name: 'Seguir' }).click();
  await expect(page.getByRole('alert')).toContainText('ISIN válido');
});

test('nota de un activo: se guarda al salir del campo y sigue ahí al volver', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  const errors = watchErrors(page);
  await page.goto(`/activo/${APPLE}`);
  await settled(page);
  const note = page.getByLabel('Nota sobre Apple');
  await note.fill('Mantener a largo plazo; revisar si baja de 180 €.');
  await note.blur();
  await expect(page.getByText('Guardada.')).toBeVisible();
  await page.reload();
  await settled(page);
  await expect(page.getByLabel('Nota sobre Apple')).toHaveValue('Mantener a largo plazo; revisar si baja de 180 €.');
  expect(errors).toEqual([]);
});
