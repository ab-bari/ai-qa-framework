/**
 * Stealth Chromium launch (plan §6.1). Ports the anti-detection flags and the
 * init script from the Python `src/utils/browser_stealth.py`: hide
 * `navigator.webdriver`, fake a plugin/language list, ensure `window.chrome`,
 * and patch the notifications permission query so headless Chromium looks like
 * a normal browser.
 */

import { chromium, type Browser } from "playwright";

export const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/122.0.0.0 Safari/537.36";

/** Injected into every page before its scripts run (context.addInitScript). */
export const STEALTH_INIT_SCRIPT = `
// Hide navigator.webdriver
Object.defineProperty(navigator, 'webdriver', { get: () => false });

// Fake plugin array (headless Chrome has zero plugins)
Object.defineProperty(navigator, 'plugins', {
  get: () => {
    const plugins = [
      { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
      { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
      { name: 'Native Client', filename: 'internal-nacl-plugin' },
    ];
    plugins.length = 3;
    return plugins;
  },
});

// Fake languages (headless Chrome can expose an empty or minimal list)
Object.defineProperty(navigator, 'languages', {
  get: () => ['en-US', 'en'],
});

// Ensure window.chrome exists with runtime (missing in headless)
if (!window.chrome) {
  window.chrome = {};
}
if (!window.chrome.runtime) {
  window.chrome.runtime = {};
}

// Fix permissions query for notifications (headless returns 'denied' instantly)
const originalQuery = window.navigator.permissions.query;
window.navigator.permissions.query = (parameters) =>
  parameters.name === 'notifications'
    ? Promise.resolve({ state: Notification.permission })
    : originalQuery(parameters);
`;

/** Launch Chromium with anti-detection arguments. */
export function launchStealthBrowser(headless = true): Promise<Browser> {
  return chromium.launch({
    headless,
    args: ["--disable-blink-features=AutomationControlled"],
  });
}
