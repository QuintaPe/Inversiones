// Una sola cartera de ejemplo para todas las pruebas (el back limita los accesos por IP).
import { test as setup, expect } from '@playwright/test';
import { PRICES } from './helpers.js';

export const STATE = 'test-results/.auth.json';

setup('sesión con la cartera de ejemplo', async ({ request }) => {
  const res = await request.post('/api/auth/demo');
  expect(res.ok()).toBeTruthy();
  // Sin cotizaciones en vivo, precios fijos para que todas las cifras y gráficas tengan valores.
  expect((await request.put('/api/prices', { data: { prices: PRICES } })).ok()).toBeTruthy();
  await request.storageState({ path: STATE });
});
