/**
 * Session guard (plan §6.3, §3 core/auth). Owns the executor's authenticated
 * session: performs the initial login once, captures `storage-state.json` for
 * injection into per-test contexts, detects session invalidation (login
 * redirect / missing success indicator / logout request), and performs a
 * SINGLE-FLIGHT re-authentication under an async mutex so a burst of parallel
 * tests triggers at most one re-login.
 *
 * Generation counter: callers capture `generation` before running a test and
 * pass it to `reauthenticate()`. If another test already refreshed the session
 * in the meantime, the call is a no-op — that is the mutex's fast path.
 */

import { existsSync, readFileSync } from "node:fs";

import type { Browser, BrowserContext, Page } from "playwright";
import { z } from "zod";

import { createStealthContext } from "../browser/context-factory.js";
import { evalDomWith } from "../browser/eval-dom.js";
import type { Logger } from "../logger.js";
import type { LLMProvider } from "../../llm/types.js";
import type { AuthConfig, ViewportConfig } from "../../schemas/config.js";
import { performSmartAuth } from "./authenticator.js";

/** The parts of Playwright's storage-state file this module reads back. */
const StorageStateSchema = z.object({
  cookies: z.array(z.record(z.string(), z.unknown())).default([]),
  origins: z
    .array(
      z.object({
        origin: z.string(),
        localStorage: z.array(z.object({ name: z.string(), value: z.string() })).default([]),
      }),
    )
    .default([]),
});

export interface SessionGuardOptions {
  browser: Browser;
  auth: AuthConfig;
  /** Absolute path where the captured storage state is written. */
  storageStatePath: string;
  logger: Logger;
  viewport: ViewportConfig;
  userAgent?: string | null | undefined;
  llm?: LLMProvider | undefined;
  /** Directory for the LLM auth-detection screenshot (tier 3). */
  screenshotDir?: string | undefined;
}

const LOGOUT_KEYWORDS = ["logout", "signout", "sign-out", "log-out"];

export class SessionGuard {
  private authenticated = false;
  private generationCounter = 0;
  private pending: Promise<boolean> | null = null;

  constructor(private readonly options: SessionGuardOptions) {}

  /** True once a login has succeeded — contexts may be seeded with storage state. */
  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  /** Increments on every successful (re-)authentication. */
  get generation(): number {
    return this.generationCounter;
  }

  /** Storage-state path to seed contexts with, or undefined when not authenticated. */
  get seedPath(): string | undefined {
    return this.authenticated ? this.options.storageStatePath : undefined;
  }

  /** Perform the initial login and capture storage state. */
  async authenticate(): Promise<boolean> {
    return this.runAuth("initial authentication");
  }

  /**
   * Re-authenticate, unless another caller already did so since
   * `seenGeneration` was captured. Concurrent callers share one login.
   */
  async reauthenticate(seenGeneration: number, reason: string): Promise<boolean> {
    if (this.generationCounter > seenGeneration) {
      this.options.logger.debug(
        `session-guard: session already refreshed (generation ${String(this.generationCounter)}), skipping re-auth`,
      );
      return this.authenticated;
    }
    if (this.pending !== null) {
      this.options.logger.debug("session-guard: joining in-flight re-authentication");
      return this.pending;
    }
    return this.runAuth(`re-authentication (${reason})`);
  }

  private async runAuth(label: string): Promise<boolean> {
    if (this.pending !== null) {
      return this.pending;
    }
    const attempt = (async (): Promise<boolean> => {
      const { logger } = this.options;
      logger.info(`session-guard: performing ${label}...`);
      const context = await createStealthContext(this.options.browser, {
        viewport: this.options.viewport,
        userAgent: this.options.userAgent,
      });
      try {
        const result = await performSmartAuth(context, this.options.auth, {
          logger,
          llm: this.options.llm,
          screenshotDir: this.options.screenshotDir,
        });
        if (!result.success) {
          logger.error(`session-guard: ${label} failed: ${result.error ?? "unknown error"}`);
          return false;
        }
        await context.storageState({ path: this.options.storageStatePath });
        this.authenticated = true;
        this.generationCounter++;
        logger.info(
          `session-guard: ${label} succeeded (generation ${String(this.generationCounter)})`,
        );
        return true;
      } finally {
        await context.close();
      }
    })();

    this.pending = attempt;
    try {
      return await attempt;
    } finally {
      this.pending = null;
    }
  }

  /**
   * Heuristic session-invalidation check for a page that finished a test:
   * the browser sat back on the login URL, or the configured success
   * indicator is gone.
   */
  async isSessionInvalidated(page: Page): Promise<boolean> {
    const { auth } = this.options;
    const stripTrailing = (url: string): string => url.replace(/\/+$/, "");
    let currentUrl: string;
    try {
      currentUrl = page.url();
    } catch {
      return false;
    }
    if (stripTrailing(currentUrl) === stripTrailing(auth.login_url)) {
      return true;
    }
    if (auth.success_indicator !== "") {
      try {
        const count = await page.locator(auth.success_indicator).count();
        if (count === 0) {
          return true;
        }
      } catch {
        // Treat an unusable selector as "cannot tell" rather than invalidated.
      }
    }
    return false;
  }

  /** True when the recorded network traffic contains a logout request. */
  static sawLogoutRequest(networkLog: readonly Record<string, unknown>[]): boolean {
    return networkLog.some((entry) => {
      const url = typeof entry.url === "string" ? entry.url.toLowerCase() : "";
      const method = typeof entry.method === "string" ? entry.method.toUpperCase() : "";
      return method === "POST" && LOGOUT_KEYWORDS.some((keyword) => url.includes(keyword));
    });
  }

  /**
   * Re-apply the captured session to a LIVE context/page (cookies plus
   * localStorage for the page's own origin), so an in-flight test can retry a
   * step after a mid-run re-authentication without a fresh context.
   */
  async applyToLiveContext(context: BrowserContext, page: Page): Promise<void> {
    const path = this.options.storageStatePath;
    if (!existsSync(path)) {
      return;
    }
    let state: z.infer<typeof StorageStateSchema>;
    try {
      state = StorageStateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      this.options.logger.debug(`session-guard: unreadable storage state: ${String(error)}`);
      return;
    }
    try {
      await context.clearCookies();
      // The file is Playwright's own storageState output, so its cookie
      // entries already satisfy the Cookie shape the schema keeps loose.
      await context.addCookies(state.cookies as unknown as Parameters<BrowserContext["addCookies"]>[0]);
    } catch (error) {
      this.options.logger.debug(`session-guard: could not restore cookies: ${String(error)}`);
    }

    let origin: string;
    try {
      origin = new URL(page.url()).origin;
    } catch {
      return;
    }
    const entry = state.origins.find((candidate) => candidate.origin === origin);
    if (entry === undefined || entry.localStorage.length === 0) {
      return;
    }
    try {
      await evalDomWith<undefined>(
        page,
        "(items) => { for (const item of items) { window.localStorage.setItem(item.name, item.value); } }",
        entry.localStorage,
      );
    } catch (error) {
      this.options.logger.debug(`session-guard: could not restore localStorage: ${String(error)}`);
    }
  }
}
