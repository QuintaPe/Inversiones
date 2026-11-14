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

test('arrastrar sobre la gráfica marca un tramo y dice lo que cambió entre sus extremos', async ({ page }) => {
  await page.goto('/efectivo');
  await settled(page);
  const svg = page.locator('.chart-block .chart svg').first();
  const box = await svg.boundingBox();
  const y = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.3, y);
  await expect(page.locator('.chart-block .tip')).not.toContainText('→');
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.7, y, { steps: 5 });
  await expect(page.locator('.chart-block .tip')).toContainText(/→.*de .*€ a .*€/s);
  await expect(svg.locator('.band')).toHaveCount(1);
  // Al soltar vuelve el valor de un solo día.
  await page.mouse.up();
  await page.mouse.move(box.x + box.width * 0.6, y);
  await expect(svg.locator('.band')).toHaveCount(0);
  await expect(page.locator('.chart-block .tip')).not.toContainText('→');
});
