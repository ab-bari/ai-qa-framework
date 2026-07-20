/**
 * Run a browser-side function body (an arrow-function source string) in the
 * page and return its result. The body is wrapped as an IIFE so Playwright
 * evaluates the *call* — a bare `() => {...}` string would otherwise evaluate to
 * a (non-serializable) function and return undefined. The explicit `T` keeps
 * the Node side typed while the browser code stays untyped (it runs in Chromium).
 */

import type { Page } from "playwright";

export function evalDom<T>(page: Page, fnBody: string): Promise<T> {
  return page.evaluate<T>(`(${fnBody})()`);
}
