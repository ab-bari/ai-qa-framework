/**
 * Tier-1 self-healing: deterministic selector resolution (plan §6.3).
 *
 * Alternatives are derived from the SiteModel's ElementModel data and bound to
 * REAL Playwright locators (`getByRole`, `getByLabel`, `getByPlaceholder`,
 * `getByTestId`, `getByText`), with a relaxed CSS selector as the last resort.
 * The framework never splices selector strings to invent alternatives (plan
 * §10 anti-pattern) — candidate specs are pure data, which also makes their
 * derivation unit-testable without a browser.
 */

import type { Locator, Page } from "playwright";

import type { Logger } from "../core/logger.js";
import type { ElementModel } from "../schemas/site-model.js";

/** A candidate locator, described as data so derivation stays pure. */
export type CandidateSpec =
  | { strategy: string; via: "role"; role: string; name: string | null }
  | { strategy: string; via: "label"; value: string }
  | { strategy: string; via: "placeholder"; value: string }
  | { strategy: string; via: "testId"; value: string }
  | { strategy: string; via: "text"; value: string }
  | { strategy: string; via: "css"; value: string };

/** ARIA roles Playwright's `getByRole` accepts — anything else is ignored. */
const ARIA_ROLES = new Set([
  "alert", "alertdialog", "application", "article", "banner", "blockquote", "button", "caption",
  "cell", "checkbox", "code", "columnheader", "combobox", "complementary", "contentinfo",
  "definition", "deletion", "dialog", "directory", "document", "emphasis", "feed", "figure",
  "form", "generic", "grid", "gridcell", "group", "heading", "img", "insertion", "link", "list",
  "listbox", "listitem", "log", "main", "marquee", "math", "menu", "menubar", "menuitem",
  "menuitemcheckbox", "menuitemradio", "meter", "navigation", "none", "note", "option",
  "paragraph", "presentation", "progressbar", "radio", "radiogroup", "region", "row", "rowgroup",
  "rowheader", "scrollbar", "search", "searchbox", "separator", "slider", "spinbutton",
  "status", "strong", "subscript", "superscript", "switch", "tab", "table", "tablist", "tabpanel",
  "term", "textbox", "time", "timer", "toolbar", "tooltip", "tree", "treegrid", "treeitem",
]);

/** Implicit role for common tags, used when the crawler recorded no role. */
const IMPLICIT_ROLES: Record<string, string> = {
  a: "link",
  button: "button",
  select: "combobox",
  textarea: "textbox",
};

function escapeAttrValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Locate the SiteModel element a plan selector refers to, when it exists. */
export function findElementForSelector(
  elements: readonly ElementModel[],
  selector: string,
): ElementModel | undefined {
  const needle = selector.trim();
  return elements.find((element) => element.selector.trim() === needle);
}

function inferRole(element: ElementModel): string | null {
  if (element.role !== "" && ARIA_ROLES.has(element.role)) {
    return element.role;
  }
  const tag = element.tag.toLowerCase();
  if (tag === "input") {
    const type = (element.attributes.type ?? "text").toLowerCase();
    if (type === "submit" || type === "button" || type === "reset") {
      return "button";
    }
    if (type === "checkbox") {
      return "checkbox";
    }
    if (type === "radio") {
      return "radio";
    }
    // `password` inputs have NO implicit ARIA role — deliberately omitted.
    if (type === "text" || type === "email" || type === "tel" || type === "url") {
      return "textbox";
    }
    return null;
  }
  return IMPLICIT_ROLES[tag] ?? null;
}

function accessibleName(element: ElementModel): string | null {
  const candidates = [
    element.attributes["aria-label"],
    element.text_content,
    element.attributes.value,
    element.attributes.title,
  ];
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed !== undefined && trimmed !== "" && trimmed.length <= 120) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Relax a CSS selector by dropping positional/negation pseudo-classes and deep
 * nesting. Returns null when nothing could be simplified. Last-resort only.
 */
export function relaxCssSelector(selector: string): string | null {
  if (/^(text|role|id|data-testid|xpath)=/.test(selector)) {
    return null;
  }
  let relaxed = selector
    .replace(/:nth-child\([^)]*\)/g, "")
    .replace(/:(first|last)-child/g, "")
    .replace(/:not\([^)]*\)/g, "")
    .replace(/:has-text\([^)]*\)/g, "");
  const parts = relaxed.split(/\s+/).filter((part) => part !== "");
  if (parts.length > 3) {
    relaxed = parts.slice(-2).join(" ");
  } else {
    relaxed = parts.join(" ");
  }
  relaxed = relaxed.trim();
  return relaxed !== "" && relaxed !== selector.trim() ? relaxed : null;
}

/**
 * Derive alternative locator specs for a failing selector, in the plan's
 * priority order: role → label → placeholder → test id → text → attribute CSS
 * → relaxed CSS.
 */
export function deriveCandidateSpecs(
  originalSelector: string,
  element: ElementModel | undefined,
  actionType: string,
): CandidateSpec[] {
  const specs: CandidateSpec[] = [];
  const seen = new Set<string>();
  const add = (spec: CandidateSpec): void => {
    const key = describeCandidate(spec);
    if (key === describeCandidate({ strategy: "", via: "css", value: originalSelector })) {
      return;
    }
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    specs.push(spec);
  };

  if (element !== undefined) {
    const attrs = element.attributes;

    const role = inferRole(element);
    if (role !== null) {
      add({ strategy: "role_name", via: "role", role, name: accessibleName(element) });
    }

    const ariaLabel = attrs["aria-label"]?.trim();
    if (ariaLabel !== undefined && ariaLabel !== "") {
      add({ strategy: "aria_label", via: "label", value: ariaLabel });
    }

    const placeholder = attrs.placeholder?.trim();
    if (placeholder !== undefined && placeholder !== "") {
      add({ strategy: "placeholder", via: "placeholder", value: placeholder });
    }

    const testId = attrs["data-testid"]?.trim();
    if (testId !== undefined && testId !== "") {
      add({ strategy: "test_id", via: "testId", value: testId });
    }
    // `data-test` is not Playwright's default test-id attribute; target it as
    // an attribute selector rather than mutating the global test-id config.
    const dataTest = attrs["data-test"]?.trim();
    if (dataTest !== undefined && dataTest !== "") {
      add({
        strategy: "data_test_attr",
        via: "css",
        value: `[data-test="${escapeAttrValue(dataTest)}"]`,
      });
    }

    const text = element.text_content.trim();
    if (
      text !== "" &&
      text.length <= 80 &&
      (actionType === "click" || actionType === "hover" || element.element_type === "link")
    ) {
      add({ strategy: "text", via: "text", value: text });
    }

    const id = attrs.id?.trim();
    if (id !== undefined && id !== "") {
      add({ strategy: "id_attr", via: "css", value: `[id="${escapeAttrValue(id)}"]` });
    }

    const name = attrs.name?.trim();
    if (name !== undefined && name !== "") {
      add({ strategy: "name_attr", via: "css", value: `[name="${escapeAttrValue(name)}"]` });
    }
  }

  const relaxed = relaxCssSelector(originalSelector);
  if (relaxed !== null) {
    add({ strategy: "relaxed_css", via: "css", value: relaxed });
  }

  return specs;
}

/** Human-readable form of a candidate — recorded in logs and StepResults. */
export function describeCandidate(spec: CandidateSpec): string {
  switch (spec.via) {
    case "role":
      return spec.name === null
        ? `getByRole('${spec.role}')`
        : `getByRole('${spec.role}', { name: '${spec.name}' })`;
    case "label":
      return `getByLabel('${spec.value}')`;
    case "placeholder":
      return `getByPlaceholder('${spec.value}')`;
    case "testId":
      return `getByTestId('${spec.value}')`;
    case "text":
      return `getByText('${spec.value}')`;
    case "css":
      return spec.value;
  }
}

/** Bind a candidate spec to a live page. */
export function toLocator(page: Page, spec: CandidateSpec): Locator {
  switch (spec.via) {
    case "role":
      return page.getByRole(
        spec.role as Parameters<Page["getByRole"]>[0],
        spec.name === null ? {} : { name: spec.name },
      );
    case "label":
      return page.getByLabel(spec.value);
    case "placeholder":
      return page.getByPlaceholder(spec.value);
    case "testId":
      return page.getByTestId(spec.value);
    case "text":
      return page.getByText(spec.value);
    case "css":
      return page.locator(spec.value);
  }
}

export interface ResolvedTarget {
  locator: Locator;
  /** "original", a candidate strategy name, or "dom_stability_retry". */
  strategy: string;
  /** Human-readable selector actually used. */
  description: string;
}

export interface ResolveTargetOptions {
  page: Page;
  selector: string;
  actionType: string;
  elements: readonly ElementModel[];
  timeoutMs: number;
  logger: Logger;
}

async function attaches(locator: Locator, timeoutMs: number): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "attached", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve a plan selector to a live locator, healing deterministically when
 * the original no longer matches. Returns null when every strategy failed —
 * callers then act on the original selector so Playwright raises its own,
 * more informative error.
 */
export async function resolveTarget(options: ResolveTargetOptions): Promise<ResolvedTarget | null> {
  const { page, selector, timeoutMs, logger } = options;
  const original = page.locator(selector);

  if (await attaches(original, timeoutMs)) {
    return { locator: original.first(), strategy: "original", description: selector };
  }
  logger.debug(`Selector '${selector}' did not attach — trying tier-1 alternatives.`);

  const shortTimeout = Math.max(500, Math.min(2000, Math.floor(timeoutMs / 3)));
  const element = findElementForSelector(options.elements, selector);
  for (const spec of deriveCandidateSpecs(selector, element, options.actionType)) {
    const locator = toLocator(page, spec);
    if (await attaches(locator, shortTimeout)) {
      const description = describeCandidate(spec);
      logger.info(`Tier-1 heal: '${selector}' -> ${description} (via ${spec.strategy})`);
      return { locator: locator.first(), strategy: spec.strategy, description };
    }
  }

  try {
    await page.waitForLoadState("networkidle", { timeout: shortTimeout });
  } catch {
    // networkidle may never settle — the retry below is the real check.
  }
  if (await attaches(original, shortTimeout)) {
    logger.info(`Tier-1 heal: '${selector}' attached after a DOM stability wait.`);
    return { locator: original.first(), strategy: "dom_stability_retry", description: selector };
  }

  logger.debug(`Tier-1 resolution exhausted for '${selector}'.`);
  return null;
}
