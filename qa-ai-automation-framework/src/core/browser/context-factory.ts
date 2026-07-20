/**
 * Stealth BrowserContext factory (plan §6.1, §3 core/browser). Applies the
 * stealth init script and the locale/timezone/header profile from the Python
 * `create_stealth_context`, and optionally seeds the context from a saved
 * Playwright storage-state file (smart-auth + storageState reuse, plan §0).
 */

import { existsSync } from "node:fs";

import type { Browser, BrowserContext } from "playwright";

import type { ViewportConfig } from "../../schemas/config.js";
import { DEFAULT_USER_AGENT, STEALTH_INIT_SCRIPT } from "./launch-stealth-browser.js";

export interface StealthContextOptions {
  viewport: ViewportConfig;
  /** null/undefined falls back to DEFAULT_USER_AGENT. */
  userAgent?: string | null | undefined;
  /** Absolute path to a Playwright storage-state JSON file to seed cookies/localStorage. */
  storageStatePath?: string | undefined;
}

export async function createStealthContext(
  browser: Browser,
  options: StealthContextOptions,
): Promise<BrowserContext> {
  const seedState =
    options.storageStatePath !== undefined && existsSync(options.storageStatePath)
      ? options.storageStatePath
      : undefined;

  const context = await browser.newContext({
    viewport: { width: options.viewport.width, height: options.viewport.height },
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    locale: "en-US",
    timezoneId: "America/New_York",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
    ...(seedState === undefined ? {} : { storageState: seedState }),
  });
  await context.addInitScript(STEALTH_INIT_SCRIPT);
  return context;
}
