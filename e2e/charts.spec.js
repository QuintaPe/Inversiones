// Gráficas: se recorren con el teclado y el punto activo se anuncia a los lectores de pantalla.
import { test, expect } from '@playwright/test';
import { settled } from './helpers.js';

test('una gráfica de columnas se recorre con las flechas', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Solo con teclado');
  await page.goto('/dividendos');
  await settled(page);
  const chart = page.getByRole('group', { name: 'Dividendos netos por mes' });
  const said = chart.locator('[aria-live]');
  await chart.focus();
  // Al entrar se coloca en el último mes, con su tooltip visible y anunciado.
  await expect(said).toContainText('€');
  await expect(chart.locator('.tip')).toBeVisible();
  const last = await said.textContent();
  await page.keyboard.press('ArrowLeft');
  await expect(said).not.toHaveText(last);
  await page.keyboard.press('Home');
  const first = await said.textContent();
  await page.keyboard.press('End');
  await expect(said).toHaveText(last);
  expect(first).not.toBe(last);
  await page.keyboard.press('Escape');
  await expect(chart.locator('.tip')).toHaveCount(0);
  await expect(said).toHaveText('');
});

test('la gráfica de líneas del efectivo también', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Solo con teclado');
  await page.goto('/efectivo');
  await settled(page);
  const chart = page.getByRole('group', { name: 'Saldo de efectivo' });
  await chart.focus();
  await page.keyboard.press('PageDown');
  await expect(chart.locator('[aria-live]')).toContainText('€');
  await page.keyboard.press('Tab'); // al salir desaparece el cursor
  await expect(chart.locator('.tip')).toHaveCount(0);
});
