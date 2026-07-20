/**
 * Auth-requirement probing (plan §6.1). After an authenticated crawl, each
 * discovered page is re-visited in a CLEAN (unauthenticated) context to decide
 * whether it truly requires auth. Signals (any one marks `auth_required = true`,
 * except on the login page itself, which is always public):
 *   - HTTP 401/403;
 *   - redirected to the login URL;
 *   - a login form (visible password field) is shown;
 *   - the login path appears in the final URL, or the title looks login-like.
 * A probe error leaves `auth_required = null` (unknown). Extends the Python
 * `_probe_auth_requirements` with the redirect + login-form signals so sites
 * whose login lives at the site root (e.g. saucedemo) are classified correctly.
 */

import type { Browser } from "playwright";

import { createStealthContext } from "../core/browser/context-factory.js";
import { evalDom } from "../core/browser/eval-dom.js";
import { normalizeUrl } from "../core/ids.js";
import type { Logger } from "../core/logger.js";
import type { ViewportConfig } from "../schemas/config.js";
import type { PageModel } from "../schemas/site-model.js";

const LOGIN_TITLE_KEYWORDS = ["login", "sign in", "log in", "authenticate"];

const PASSWORD_VISIBLE_SCRIPT = `() => {
  const pw = document.querySelector('input[type="password"]');
  if (!pw) return false;
  const r = pw.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}`;

export interface AuthProbeOptions {
  viewport: ViewportConfig;
  userAgent?: string | null;
  /** The configured login URL. */
  loginUrl: string;
}

function safeNormalize(url: string): string | null {
  try {
    return normalizeUrl(url);
  } catch {
    return null;
  }
}

export async function probeAuthRequirements(
  browser: Browser,
  pages: PageModel[],
  options: AuthProbeOptions,
  logger: Logger,
): Promise<void> {
  if (pages.length === 0) {
    return;
  }
  logger.info(`Probing ${String(pages.length)} pages for auth requirements`);

  const loginNorm = safeNormalize(options.loginUrl);
  let loginPath = "";
  try {
    loginPath = new URL(options.loginUrl).pathname.replace(/\/+$/, "");
  } catch {
    loginPath = "";
  }

  const context = await createStealthContext(browser, {
    viewport: options.viewport,
    userAgent: options.userAgent,
  });
  const probe = await context.newPage();

  try {
    for (const page of pages) {
      const requestedNorm = safeNormalize(page.url);
      const isLoginPage = requestedNorm !== null && requestedNorm === loginNorm;
      try {
        const resp = await probe.goto(page.url, { waitUntil: "domcontentloaded", timeout: 10_000 });
        if (isLoginPage) {
          // The login page is public by definition.
          page.auth_required = false;
          continue;
        }
        if (resp === null) {
          page.auth_required = true;
          continue;
        }
        // Let client-side auth guards run (SPA redirect / login-form render).
        try {
          await probe.waitForLoadState("networkidle", { timeout: 5000 });
        } catch {
          // networkidle may not settle — fall through.
        }
        await probe.waitForTimeout(500);
        const status = resp.status();
        if (status === 401 || status === 403) {
          page.auth_required = true;
          continue;
        }

        const landedNorm = safeNormalize(probe.url());
        if (landedNorm !== null && landedNorm === loginNorm && landedNorm !== requestedNorm) {
          page.auth_required = true;
          continue;
        }

        let visiblePassword = false;
        try {
          visiblePassword = await evalDom<boolean>(probe, PASSWORD_VISIBLE_SCRIPT);
        } catch {
          visiblePassword = false;
        }
        if (visiblePassword) {
          page.auth_required = true;
          continue;
        }

        let finalPath = "";
        try {
          finalPath = new URL(probe.url()).pathname;
        } catch {
          finalPath = "";
        }
        if (loginPath !== "" && finalPath.includes(loginPath)) {
          page.auth_required = true;
          continue;
        }

        const title = ((await probe.title()) || "").toLowerCase();
        page.auth_required = LOGIN_TITLE_KEYWORDS.some((kw) => title.includes(kw));
      } catch (error) {
        logger.debug(`auth probe failed for ${page.url}: ${String(error)}`);
        page.auth_required = null;
      }
    }
  } finally {
    await probe.close();
    await context.close();
  }

  const authCount = pages.filter((p) => p.auth_required === true).length;
  const publicCount = pages.filter((p) => p.auth_required === false).length;
  logger.info(`Auth probe: ${String(authCount)} require auth, ${String(publicCount)} public`);
}
