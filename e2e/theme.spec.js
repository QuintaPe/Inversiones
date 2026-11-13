// Temas: el del sistema por defecto y el elegido en la app, que manda sobre el del sistema.
import { test, expect } from '@playwright/test';
import { settled } from './helpers.js';

const bg = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const DARK = 'rgb(7, 7, 10)', LIGHT = 'rgb(246, 246, 249)';

test('el tema elegido manda sobre el del sistema y se recuerda', async ({ page }, info) => {
  test.skip(info.project.name !== 'escritorio-oscuro', 'Un solo proyecto basta');
  await page.goto('/resumen');
  await settled(page);
  expect(await bg(page)).toBe(DARK);

  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Claro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await bg(page)).toBe(LIGHT);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', LIGHT);

  await page.reload();
  await settled(page);
  expect(await bg(page)).toBe(LIGHT);

  await page.getByRole('button', { name: 'Cuenta' }).click();
  await page.getByRole('group', { name: 'Tema' }).getByRole('button', { name: 'Auto' }).click();
  expect(await bg(page)).toBe(DARK);
  await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#07070a');
});
