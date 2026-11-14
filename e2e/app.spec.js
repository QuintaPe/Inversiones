// Recorrido de la app con la cartera de ejemplo: cada sección pinta, sin errores en la consola
// y sin scroll horizontal, en escritorio y en móvil, con los dos temas.
import { test, expect } from '@playwright/test';
import { watchErrors, settled, overflow, SECTIONS, APPLE } from './helpers.js';

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('la pantalla de acceso ofrece la cartera de ejemplo', async ({ page }) => {
    await page.goto('/');
    const btn = page.getByRole('button', { name: /ejemplo/i });
    await expect(btn).toBeVisible();
    await btn.click();
    await expect(page.getByRole('button', { name: /Cartera de ejemplo con datos inventados/ })).toBeVisible();
  });
});

for (const [route, title] of SECTIONS) {
  test(`sección ${route}`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.goto(`/${route}`);
    await settled(page);
    if (title) await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    expect(await overflow(page)).toBeLessThanOrEqual(0);
    expect(errors).toEqual([]);
  });
}

test('ficha de un activo', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(`/activo/${APPLE}`);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Apple' }).first()).toBeVisible();
  expect(await overflow(page)).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
