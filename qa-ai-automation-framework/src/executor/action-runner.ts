/**
 * Action runner (plan §6.3): translates the 9 plan Action types into
 * Playwright calls. Selector-based actions go through tier-1 deterministic
 * resolution first (`selector-resolver.ts`), so a stale selector heals before
 * the step is considered failed. Throws on failure — the test runner turns the
 * throw into a StepResult and decides whether to invoke the tier-2 AI fallback.
 */

import type { Locator, Page } from "playwright";

import { evalDom, evalDomWith } from "../core/browser/eval-dom.js";
import type { Logger } from "../core/logger.js";
import type { ElementModel } from "../schemas/site-model.js";
import type { Action } from "../schemas/test-plan.js";
import { maskSecrets } from "./placeholders.js";
import { resolveTarget } from "./selector-resolver.js";

export interface ActionRunOptions {
  page: Page;
  /** Per-action selector timeout (config.selector_timeout_seconds). */
  timeoutMs: number;
  /** SiteModel elements for the page under test — tier-1 healing input. */
  elements: readonly ElementModel[];
  logger: Logger;
  /** Disabled when replaying an AI-suggested selector, which must not re-heal. */
  smartResolve: boolean;
  secrets: readonly string[];
}

/** Floor for `navigate` timeouts, matching Playwright's own default. */
const MIN_NAVIGATION_TIMEOUT_MS = 30_000;

export interface ActionOutcome {
  /** The selector/locator actually used — differs from the plan when healed. */
  effectiveSelector: string;
  /** "original", "none" (no selector), or the healing strategy that worked. */
  strategy: string;
}

/** Small randomized pause; headless automation that acts instantly is flagged. */
async function humanDelay(page: Page, minMs: number, maxMs: number): Promise<void> {
  await page.waitForTimeout(minMs + Math.floor(Math.random() * (maxMs - minMs)));
}

async function target(
  action: Action,
  options: ActionRunOptions,
): Promise<{ locator: Locator; outcome: ActionOutcome }> {
  const selector = action.selector;
  if (selector === null || selector === "") {
    throw new Error(`${action.action_type} action requires a selector`);
  }
  if (!options.smartResolve) {
    return {
      locator: options.page.locator(selector).first(),
      outcome: { effectiveSelector: selector, strategy: "original" },
    };
  }
  const resolved = await resolveTarget({
    page: options.page,
    selector,
    actionType: action.action_type,
    elements: options.elements,
    timeoutMs: options.timeoutMs,
    logger: options.logger,
  });
  if (resolved === null) {
    // Act on the original so Playwright produces its own diagnostic error.
    return {
      locator: options.page.locator(selector).first(),
      outcome: { effectiveSelector: selector, strategy: "unresolved" },
    };
  }
  return {
    locator: resolved.locator,
    outcome: { effectiveSelector: resolved.description, strategy: resolved.strategy },
  };
}

/** Execute one action; throws on failure. */
export async function runAction(action: Action, options: ActionRunOptions): Promise<ActionOutcome> {
  const { page, timeoutMs, logger, secrets } = options;
  const noSelector: ActionOutcome = { effectiveSelector: "", strategy: "none" };

  switch (action.action_type) {
    case "navigate": {
      const url = action.value ?? action.selector ?? "";
      if (url === "") {
        throw new Error("navigate action requires a url in `value`");
      }
      logger.debug(`navigate -> ${url}`);
      // A full page load deserves more headroom than a selector lookup:
      // `selector_timeout_seconds` is tuned for finding elements, not for
      // fetching a document over the network.
      const navigationTimeoutMs = Math.max(timeoutMs, MIN_NAVIGATION_TIMEOUT_MS);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: navigationTimeoutMs });
      try {
        await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 10_000) });
      } catch {
        logger.debug("networkidle did not settle after navigation — continuing.");
      }
      return { effectiveSelector: url, strategy: "none" };
    }

    case "click": {
      await humanDelay(page, 50, 250);
      const { locator, outcome } = await target(action, options);
      logger.debug(`click -> ${outcome.effectiveSelector}`);
      await locator.click({ timeout: timeoutMs });
      return outcome;
    }

    case "fill": {
      await humanDelay(page, 80, 300);
      const { locator, outcome } = await target(action, options);
      const value = action.value ?? "";
      logger.debug(`fill ${outcome.effectiveSelector} with '${maskSecrets(value, secrets)}'`);
      await locator.fill(value, { timeout: timeoutMs });
      return outcome;
    }

    case "select": {
      await humanDelay(page, 50, 250);
      const { locator, outcome } = await target(action, options);
      logger.debug(`select '${action.value ?? ""}' in ${outcome.effectiveSelector}`);
      await locator.selectOption(action.value ?? "", { timeout: timeoutMs });
      return outcome;
    }

    case "hover": {
      await humanDelay(page, 30, 150);
      const { locator, outcome } = await target(action, options);
      logger.debug(`hover -> ${outcome.effectiveSelector}`);
      await locator.hover({ timeout: timeoutMs });
      return outcome;
    }

    case "wait": {
      if (action.selector !== null && action.selector !== "") {
        const { locator, outcome } = await target(action, options);
        logger.debug(`wait for ${outcome.effectiveSelector}`);
        await locator.waitFor({ state: "visible", timeout: timeoutMs });
        return outcome;
      }
      const ms = Number.parseInt(action.value ?? "", 10);
      const waitMs = Number.isNaN(ms) ? 1000 : Math.min(Math.max(ms, 0), timeoutMs);
      logger.debug(`wait ${String(waitMs)}ms`);
      await page.waitForTimeout(waitMs);
      return noSelector;
    }

    case "scroll": {
      if (action.selector !== null && action.selector !== "") {
        const { locator, outcome } = await target(action, options);
        logger.debug(`scroll ${outcome.effectiveSelector} into view`);
        await locator.scrollIntoViewIfNeeded({ timeout: timeoutMs });
        return outcome;
      }
      // Numeric offset only — never interpolate plan text into page script.
      const offset = Number.parseInt(action.value ?? "", 10);
      if (Number.isNaN(offset)) {
        logger.debug("scroll to bottom of page");
        await evalDom<undefined>(page, "() => { window.scrollTo(0, document.body.scrollHeight); }");
      } else {
        logger.debug(`scroll to y=${String(offset)}`);
        await evalDomWith<undefined>(page, "(y) => { window.scrollTo(0, y); }", offset);
      }
      return noSelector;
    }

    case "keyboard": {
      const key = action.value ?? "Enter";
      logger.debug(`keyboard press ${key}`);
      await page.keyboard.press(key);
      return noSelector;
    }

    case "screenshot":
      // Screenshots are captured by the evidence collector after every step;
      // an explicit screenshot action is therefore a no-op marker.
      logger.debug("screenshot action — handled by the evidence collector");
      return noSelector;
  }
}
