import { test as base, expect, type ConsoleMessage } from '@playwright/test';

/**
 * Network-layer failures (a 404 favicon, a CORS-blocked third-party beacon)
 * surface as console errors but are not page-script faults. They are excluded
 * so `expect(consoleErrors).toEqual([])` stays meaningful on real sites. This
 * mirrors the qa-ai executor's `no_console_errors` filtering.
 */
function isResourceLoadNoise(text: string): boolean {
  return (
    text.includes('Failed to load resource') ||
    text.includes('has been blocked by CORS policy') ||
    text.toLowerCase().includes('favicon')
  );
}

interface Fixtures {
  /**
   * Collects genuine page-script console errors (uncaught exceptions and
   * `console.error`), filtering resource-load/CORS/favicon noise. Request it in
   * a test and assert `expect(consoleErrors).toEqual([])` — no manual waits.
   */
  consoleErrors: string[];
}

export const test = base.extend<Fixtures>({
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error' && !isResourceLoadNoise(msg.text())) {
        errors.push(msg.text());
      }
    });
    page.on('pageerror', (error: Error) => {
      errors.push(error.message);
    });
    await use(errors);
  },
});

export { expect };
