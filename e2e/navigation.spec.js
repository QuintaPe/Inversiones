// Navegación: URLs limpias, enlaces antiguos con hash, estado en la URL, scroll al volver,
// título de la pestaña y foco para teclado y lectores de pantalla.
import { test, expect } from '@playwright/test';
import { settled, APPLE } from './helpers.js';

const h1 = (page, name) => expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

test('los enlaces antiguos con hash llevan a la ruta limpia', async ({ page }) => {
  await page.goto(`/#/activo/${APPLE}`);
  await expect(page).toHaveURL(`/activo/${APPLE}`);
  await settled(page);
  await expect(page.getByRole('heading', { name: 'Apple' }).first()).toBeVisible();
});

test('la raíz y las rutas desconocidas van al resumen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/resumen');
  await page.goto('/no-existe');
  await expect(page).toHaveURL('/resumen');
  await page.goto('/%E0%A4%A');
  await expect(page).toHaveURL('/resumen');
  await page.goBack();
  await expect(page).not.toHaveURL(/no-existe/); // sin dejar la ruta mala en el historial
});

test('navegar cambia la URL, el título y lleva el foco al contenido', async ({ page, isMobile }) => {
  await page.goto('/resumen');
  await settled(page);
  await expect(page).toHaveTitle('Resumen · Cartera');
  const nav = page.getByRole('navigation', { name: 'Secciones' }).locator('visible=true');
  await nav.getByRole('link', { name: 'Dividendos' }).click();
  await expect(page).toHaveURL('/dividendos');
  await h1(page, 'Dividendos');
  await expect(page).toHaveTitle('Dividendos · Cartera');
  await expect(page.locator('#main')).toBeFocused();
  await page.goBack();
  await expect(page).toHaveURL('/resumen');
  if (!isMobile) await expect(page.getByRole('link', { name: 'Dividendos' }).first()).toHaveAttribute('href', '/dividendos');
});

test('filtros y pestañas viven en la URL y sobreviven a recargar', async ({ page }) => {
  await page.goto('/operaciones');
  await settled(page);
  await page.getByRole('group', { name: 'Tipo de operación' }).getByRole('button', { name: 'Ventas' }).click();
  await expect(page).toHaveURL('/operaciones?tipo=ventas');
  await page.reload();
  await settled(page);
  await expect(page.getByRole('button', { name: 'Ventas' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto(`/activo/${APPLE}?ver=operaciones`);
  await settled(page);
  await expect(page.getByRole('tab', { name: /Operaciones/ })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: /Resumen/ }).click();
  await expect(page).toHaveURL(`/activo/${APPLE}`); // el valor por defecto no ensucia la URL
});

test('un valor desconocido en la URL cae en el de por defecto', async ({ page }) => {
  await page.goto('/posiciones?ver=inventado');
  await settled(page);
  await expect(page.getByRole('tab', { name: /Abiertas/ })).toHaveAttribute('aria-selected', 'true');
});

test('volver desde la ficha recupera el scroll de la lista', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 500 });
  await page.goto('/posiciones');
  await settled(page);
  // Se coloca la fila y se pulsa con el ratón en sus coordenadas: los clics de Playwright sobre
  // un elemento pueden volver a desplazar la página justo antes de pulsar.
  const name = page.getByRole('row', { name: /Coca-Cola/ }).getByText('Coca-Cola');
  await name.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const box = await name.boundingBox();
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(200);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page).toHaveURL(/\/activo\//);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0); // la ficha empieza arriba
  await page.getByRole('button', { name: 'Volver' }).click();
  await expect(page).toHaveURL('/posiciones');
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before - 5);
});

test('volver desde una ficha abierta por enlace directo va a Posiciones', async ({ page }) => {
  await page.goto(`/activo/${APPLE}`);
  await settled(page);
  await page.getByRole('button', { name: 'Volver' }).click();
  await expect(page).toHaveURL('/posiciones');
});

test('el enlace para saltar al contenido aparece con el teclado', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Solo con teclado');
  await page.goto('/resumen');
  await settled(page);
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});
