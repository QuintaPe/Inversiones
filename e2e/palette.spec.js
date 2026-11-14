// Buscador (Ctrl+K): además de ir a secciones y valores, ejecuta acciones.
import { test, expect } from '@playwright/test';
import { watchErrors, settled } from './helpers.js';

test('buscador: ejecuta acciones y va a un valor', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/resumen');
  await settled(page);
  const open = () => page.getByRole('button', { name: 'Buscar (Ctrl+K)' }).click();
  const box = page.getByRole('combobox', { name: 'Buscar' });
  const opts = page.locator('#palette-list');

  await open();
  await box.fill('ocultar');
  await expect(opts.getByRole('option').first()).toContainText('Ocultar los importes');
  await box.press('Enter');
  await expect(page.locator('html')).toHaveClass(/private/);
  await expect(box).toHaveCount(0);

  // La acción cambia con el estado, y los sinónimos también la encuentran.
  await open();
  await box.fill('cifras');
  await expect(opts.getByRole('option').first()).toContainText('Mostrar los importes');
  await box.press('Enter');
  await expect(page.locator('html')).not.toHaveClass(/private/);

  await open();
  await box.fill('tema oscuro');
  await expect(opts.getByRole('option')).toHaveCount(0);
  await box.fill('oscuro');
  await opts.getByRole('option', { name: /Tema: oscuro/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  await open();
  await box.fill('añadir');
  await box.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');

  await open();
  await box.fill('apple');
  await box.press('Enter');
  await expect(page).toHaveURL(/\/activo\/US0378331005$/);
  expect(errors).toEqual([]);
});
