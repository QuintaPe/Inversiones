// Sesión: cerrar, volver a entrar y sesión caducada.
import { test, expect } from '@playwright/test';
import { settled, ownAccount } from './helpers.js';

const DEMO = 'Probar con una cartera de ejemplo';

test('cerrar sesión lleva al acceso y se puede volver a entrar', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  await page.goto('/posiciones');
  await settled(page);
  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('menuitem', { name: 'Cerrar sesión' }).click();
  await expect(page.getByRole('button', { name: DEMO })).toBeVisible();
  // Nada de la cuenta anterior queda en pantalla.
  await expect(page.locator('.view')).toHaveCount(0);

  await page.getByRole('button', { name: DEMO }).click();
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Posiciones', level: 1 })).toBeVisible();
  await page.context().close();
});

test('con la sesión caducada, la siguiente petición devuelve al acceso con un aviso', async ({ browser }, testInfo) => {
  const page = await ownAccount(browser, testInfo);
  await page.goto('/posiciones');
  await settled(page);
  await page.context().clearCookies();
  await page.getByRole('tab', { name: 'Seguimiento' }).click(); // pide /api/watchlist
  await expect(page.getByText('Tu sesión ha caducado. Vuelve a iniciar sesión.')).toBeVisible();
  await expect(page.getByRole('button', { name: DEMO })).toBeVisible();
  await page.context().close();
});
