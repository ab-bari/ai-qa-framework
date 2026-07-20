import { test, expect } from '../src/fixtures/base';

// Baseline smoke — proves the environment is wired up (baseURL reachable,
// fixtures import cleanly) before any generated feature specs run.
test.describe('Seed — environment baseline @smoke', () => {
  test('base URL is reachable', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok() ?? true).toBeTruthy();
  });
});
