/**
 * Link discovery (plan §6.1). Four strategies unioned per page — static
 * anchors, SPA router links, dynamic attributes/onclick, and interactive nav
 * toggles clicked in place — plus SPA-type detection and sitemap.xml backfill.
 * Ported from the Python `crawler.py` link-discovery methods and `spa_handler.py`.
 *
 * The `page.evaluate` bodies are passed as strings (they run in Chromium); the
 * Node side stays fully typed. URL resolution/validation lives here as pure,
 * testable helpers.
 */

import type { BrowserContext, Page } from "playwright";

import { evalDom } from "../core/browser/eval-dom.js";
import type { Logger } from "../core/logger.js";

const SKIP_EXTENSIONS = [
  ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".webp",
  ".css", ".js", ".map", ".woff", ".woff2", ".ttf", ".eot",
  ".pdf", ".zip", ".tar", ".gz", ".mp3", ".mp4", ".webm",
  ".xml", ".rss", ".atom", ".json",
];

/** Filter out non-page URLs (assets, feeds) — port of `_is_valid_page_url`. */
export function isValidPageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const pathLower = parsed.pathname.toLowerCase();
  return !SKIP_EXTENSIONS.some((ext) => pathLower.endsWith(ext));
}

/** Resolve raw hrefs to absolute, deduplicated, valid page URLs — port of `_resolve_urls`. */
export function resolveUrls(hrefs: string[], baseUrl: string): Set<string> {
  const resolved = new Set<string>();
  for (const href of hrefs) {
    try {
      const full = new URL(href, baseUrl);
      let clean = `${full.protocol}//${full.host}${full.pathname}`;
      if (full.search !== "") {
        clean += full.search;
      }
      if (isValidPageUrl(clean)) {
        resolved.add(clean);
      }
    } catch {
      // Unparseable href — skip.
    }
  }
  return resolved;
}

const DETECT_SPA_SCRIPT = `() => {
  const hasReact = !!document.querySelector('[data-reactroot], [data-reactid], #root, #__next');
  const hasVue = !!document.querySelector('[data-v-], #app, [data-server-rendered]');
  const hasAngular = !!document.querySelector('[ng-app], [data-ng-app], app-root');
  const hasHashRouting = window.location.hash.length > 1;
  if (hasHashRouting) return 'hash';
  if (hasReact || hasVue || hasAngular) return 'history';
  return 'traditional';
}`;

const SPA_ROUTES_SCRIPT = `() => {
  const routes = [];
  for (const link of document.querySelectorAll('a[href]')) {
    const href = link.getAttribute('href');
    if (href && (href.startsWith('/') || href.startsWith('#/'))) routes.push(href);
  }
  return [...new Set(routes)];
}`;

const STATIC_LINKS_SCRIPT = `() => {
  const results = [];
  document.querySelectorAll('a[href]').forEach(el => results.push(el.href));
  document.querySelectorAll('area[href]').forEach(el => results.push(el.href));
  document.querySelectorAll('frame[src], iframe[src]').forEach(el => { if (el.src) results.push(el.src); });
  return results.filter(h => h &&
    !h.startsWith('javascript:') && !h.startsWith('mailto:') &&
    !h.startsWith('tel:') && !h.startsWith('data:') && !h.startsWith('blob:'));
}`;

const DYNAMIC_LINKS_SCRIPT = `() => {
  const results = [];
  document.querySelectorAll('[onclick]').forEach(el => {
    const onclick = el.getAttribute('onclick') || '';
    const locMatch = onclick.match(/(?:window\\.)?location(?:\\.href)?\\s*=\\s*["']([^"']+)["']/);
    if (locMatch) results.push(locMatch[1]);
    const navMatch = onclick.match(/(?:navigate|goto|redirect|router\\.push)\\s*\\(?\\s*["']([^"']+)["']/i);
    if (navMatch) results.push(navMatch[1]);
  });
  const dataAttrs = ['data-href', 'data-url', 'data-link', 'data-to', 'data-route'];
  for (const attr of dataAttrs) {
    document.querySelectorAll('[' + attr + ']').forEach(el => {
      const val = el.getAttribute(attr);
      if (val && (val.startsWith('/') || val.startsWith('http'))) results.push(val);
    });
  }
  document.querySelectorAll('button[formaction], input[formaction]').forEach(el => {
    const val = el.getAttribute('formaction');
    if (val) results.push(val);
  });
  document.querySelectorAll('meta[http-equiv="refresh"]').forEach(el => {
    const content = el.getAttribute('content') || '';
    const match = content.match(/url\\s*=\\s*["']?([^"';\\s]+)/i);
    if (match) results.push(match[1]);
  });
  document.querySelectorAll('form[action]').forEach(el => {
    const action = el.getAttribute('action');
    if (action && action !== '#' && !action.startsWith('javascript:')) results.push(action);
  });
  return results.filter(r => r && !r.startsWith('javascript:'));
}`;

const NAV_TOGGLES_SCRIPT = `() => {
  const selectors = [];
  const candidates = document.querySelectorAll(
    'nav button, nav [role="button"], [class*="menu-toggle"], [class*="hamburger"], ' +
    '[class*="nav-toggle"], [class*="dropdown-toggle"], [aria-haspopup="true"], ' +
    '[data-toggle="dropdown"], [data-bs-toggle="dropdown"], button[aria-expanded="false"], ' +
    '[class*="navbar-toggler"], details > summary'
  );
  for (const el of candidates) {
    if (el.offsetParent === null && !el.closest('details')) continue;
    let sel = '';
    if (el.id) sel = '#' + CSS.escape(el.id);
    else if (el.getAttribute('aria-label')) sel = '[aria-label="' + el.getAttribute('aria-label') + '"]';
    else if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/)[0];
      if (cls) sel = el.tagName.toLowerCase() + '.' + CSS.escape(cls);
    }
    if (sel) selectors.push(sel);
  }
  return selectors.slice(0, 8);
}`;

const VISIBLE_LINKS_SCRIPT = `() => {
  return Array.from(document.querySelectorAll('a[href]'))
    .filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(a => a.href)
    .filter(h => h && !h.startsWith('javascript:') && !h.startsWith('mailto:') && !h.startsWith('tel:'));
}`;

/** Detect SPA routing type; returns "traditional" | "hash" | "history". */
export async function detectSpaType(page: Page): Promise<string> {
  try {
    return await evalDom<string>(page, DETECT_SPA_SCRIPT);
  } catch {
    return "traditional";
  }
}

async function evaluateStringList(page: Page, script: string): Promise<string[]> {
  try {
    return await evalDom<string[]>(page, script);
  } catch {
    return [];
  }
}

async function discoverInteractiveLinks(page: Page, baseUrl: string, logger: Logger): Promise<Set<string>> {
  const discovered = new Set<string>();
  try {
    const linksBefore = new Set(await evaluateStringList(page, VISIBLE_LINKS_SCRIPT));
    const toggles = await evaluateStringList(page, NAV_TOGGLES_SCRIPT);
    const originalUrl = page.url();

    for (const selector of toggles) {
      try {
        const locator = page.locator(selector).first();
        if (!(await locator.isVisible())) {
          continue;
        }
        await locator.click({ timeout: 3000 });
        await page.waitForTimeout(500);
        const linksAfter = await evaluateStringList(page, VISIBLE_LINKS_SCRIPT);
        const fresh = linksAfter.filter((href) => !linksBefore.has(href));
        for (const url of resolveUrls(fresh, baseUrl)) {
          discovered.add(url);
        }
        try {
          await page.keyboard.press("Escape");
          await page.waitForTimeout(300);
        } catch {
          // Menu may not respond to Escape — ignore.
        }
      } catch (error) {
        logger.debug(`interactive click failed (${selector}): ${String(error)}`);
      }
    }

    if (page.url() !== originalUrl) {
      try {
        await page.goto(originalUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
      } catch {
        // Best-effort restore.
      }
    }
  } catch (error) {
    logger.debug(`interactive link discovery error: ${String(error)}`);
  }
  return discovered;
}

/** Run all discovery strategies and return the union of resolved, valid page URLs. */
export async function discoverLinks(
  page: Page,
  baseUrl: string,
  isSpa: boolean,
  logger: Logger,
): Promise<Set<string>> {
  const discovered = new Set<string>();

  for (const url of resolveUrls(await evaluateStringList(page, STATIC_LINKS_SCRIPT), baseUrl)) {
    discovered.add(url);
  }

  if (isSpa) {
    for (const url of resolveUrls(await evaluateStringList(page, SPA_ROUTES_SCRIPT), baseUrl)) {
      discovered.add(url);
    }
  }

  for (const url of resolveUrls(await evaluateStringList(page, DYNAMIC_LINKS_SCRIPT), baseUrl)) {
    discovered.add(url);
  }

  for (const url of await discoverInteractiveLinks(page, baseUrl, logger)) {
    discovered.add(url);
  }

  return discovered;
}

/** Fetch sitemap.xml and return its <loc> URLs (low-priority backfill). */
export async function fetchSitemapUrls(context: BrowserContext, startUrl: string): Promise<string[]> {
  let sitemapUrl: string;
  try {
    const parsed = new URL(startUrl);
    sitemapUrl = `${parsed.protocol}//${parsed.host}/sitemap.xml`;
  } catch {
    return [];
  }
  const page = await context.newPage();
  try {
    const resp = await page.goto(sitemapUrl, { waitUntil: "domcontentloaded", timeout: 10_000 });
    if (resp?.status() !== 200) {
      return [];
    }
    const content = await page.content();
    const matches = content.matchAll(/<loc>\s*(https?:\/\/[^<\s]+)\s*<\/loc>/g);
    const urls: string[] = [];
    for (const match of matches) {
      const loc = match[1];
      if (loc !== undefined && isValidPageUrl(loc)) {
        urls.push(loc);
      }
    }
    return urls;
  } catch {
    return [];
  } finally {
    await page.close();
  }
}
