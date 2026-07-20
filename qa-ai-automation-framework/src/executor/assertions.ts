/**
 * Assertion evaluation (plan §6.3): the 14 assertion types.
 *
 * `ai_evaluate` is the vision judge — it passes only when the model's verdict
 * is true AND confidence >= 0.7. `screenshot_diff` resolves to `skip` in v1
 * (visual testing is deferred, plan §10) — recorded explicitly in the artifact
 * rather than silently dropped (plan §10 anti-pattern).
 */

import { join } from "node:path";

import type { Page } from "playwright";
import { z } from "zod";

import type { Logger } from "../core/logger.js";
import type { LLMProvider } from "../llm/types.js";
import type { Assertion } from "../schemas/test-plan.js";
import type { NetworkEntry } from "./evidence.js";

export type AssertionStatus = "pass" | "fail" | "skip";

export interface AssertionOutcome {
  status: AssertionStatus;
  message: string;
  /** Recorded on the AssertionResult so failures show what was actually seen. */
  actualValue?: string | null;
  /** Extra screenshots captured while evaluating (e.g. the ai_evaluate shot). */
  screenshots?: string[];
}

export interface AssertionContext {
  page: Page;
  /** Absolute directory for assertion-captured artifacts. */
  evidenceDir: string;
  consoleLogs: readonly string[];
  networkLog: readonly NetworkEntry[];
  logger: Logger;
  llm?: LLMProvider | undefined;
  timeoutMs: number;
}

const AI_EVALUATE_CONFIDENCE_THRESHOLD = 0.7;

const AiVerdictSchema = z.object({
  verdict: z.boolean(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().default(""),
});

const AI_EVALUATE_SYSTEM_PROMPT = `You are a QA assertion evaluator. You look at a web page's current state and decide whether a stated intent has been satisfied.

You will receive a screenshot path, the page URL, a text excerpt, and the intent.

Fields:
- verdict: boolean — true when the intent is clearly satisfied by the page state.
- confidence: float 0.0-1.0 — how sure you are.
- reasoning: one or two sentences explaining the judgment.

Guidelines:
- Judge the intent holistically: URL, visible UI, page content and screenshot together.
- Be strict but fair. If the page shows the intended outcome was achieved, return verdict true.
- If the page shows an error state, is still on the same form, or shows no evidence the intent was met, return verdict false.
- Do NOT require specific words like "success" or "welcome" — judge the functional outcome.
- Set confidence below 0.7 when the evidence is ambiguous; the framework treats low-confidence passes as failures.`;

function pass(message: string, actualValue?: string | null): AssertionOutcome {
  return actualValue === undefined ? { status: "pass", message } : { status: "pass", message, actualValue };
}

function fail(message: string, actualValue?: string | null): AssertionOutcome {
  return actualValue === undefined ? { status: "fail", message } : { status: "fail", message, actualValue };
}

/** `title` is answered by page.title() — more reliable than a DOM query. */
async function textForSelector(
  ctx: AssertionContext,
  selector: string | null,
): Promise<string> {
  if (selector === null || selector === "") {
    return (await ctx.page.locator("body").textContent()) ?? "";
  }
  if (selector.trim().toLowerCase() === "title") {
    return await ctx.page.title();
  }
  const locator = ctx.page.locator(selector).first();
  await locator.waitFor({ state: "attached", timeout: ctx.timeoutMs });
  return (await locator.textContent()) ?? "";
}

async function checkElementVisible(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  if (assertion.selector === null || assertion.selector === "") {
    return fail("element_visible requires a selector");
  }
  try {
    await ctx.page
      .locator(assertion.selector)
      .first()
      .waitFor({ state: "visible", timeout: ctx.timeoutMs });
    return pass(`Element '${assertion.selector}' is visible`);
  } catch {
    return fail(`Element '${assertion.selector}' is not visible`);
  }
}

async function checkElementHidden(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  if (assertion.selector === null || assertion.selector === "") {
    return fail("element_hidden requires a selector");
  }
  const locator = ctx.page.locator(assertion.selector).first();
  if ((await locator.count()) === 0) {
    return pass(`Element '${assertion.selector}' is not in the DOM`);
  }
  const visible = await locator.isVisible();
  return visible
    ? fail(`Element '${assertion.selector}' is still visible`)
    : pass(`Element '${assertion.selector}' is hidden`);
}

async function checkTextContains(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const expected = assertion.expected_value;
  if (expected === null || expected === "") {
    return fail("text_contains requires expected_value");
  }
  const text = await textForSelector(ctx, assertion.selector);
  return text.toLowerCase().includes(expected.toLowerCase())
    ? pass(`Found '${expected}'`, text.slice(0, 200))
    : fail(`'${expected}' not found in text`, text.slice(0, 200));
}

async function checkTextEquals(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const expected = assertion.expected_value;
  if (expected === null || assertion.selector === null || assertion.selector === "") {
    return fail("text_equals requires a selector and expected_value");
  }
  const text = (await textForSelector(ctx, assertion.selector)).trim();
  return text === expected
    ? pass("Text matches exactly", text)
    : fail(`Expected '${expected}', got '${text}'`, text);
}

async function checkTextMatches(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const pattern = assertion.expected_value;
  if (pattern === null || pattern === "") {
    return fail("text_matches requires expected_value (a regex)");
  }
  let regex: RegExp;
  try {
    regex = new RegExp(pattern, "i");
  } catch (error) {
    return fail(`Invalid regex '${pattern}': ${String(error)}`);
  }
  const text = await textForSelector(ctx, assertion.selector);
  return regex.test(text)
    ? pass(`Pattern '${pattern}' matched`, text.slice(0, 200))
    : fail(`Pattern '${pattern}' did not match`, text.slice(0, 200));
}

function checkUrlMatches(assertion: Assertion, ctx: AssertionContext): AssertionOutcome {
  const expected = assertion.expected_value;
  if (expected === null || expected === "") {
    return fail("url_matches requires expected_value");
  }
  const current = ctx.page.url();
  if (current.includes(expected)) {
    return pass(`URL contains '${expected}'`, current);
  }
  try {
    if (new RegExp(expected).test(current)) {
      return pass(`URL matches /${expected}/`, current);
    }
  } catch {
    // Not a valid regex — the substring check above was the whole test.
  }
  return fail(`URL '${current}' does not match '${expected}'`, current);
}

async function checkElementCount(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  if (assertion.selector === null || assertion.expected_value === null) {
    return fail("element_count requires a selector and expected_value");
  }
  const expected = Number.parseInt(assertion.expected_value, 10);
  if (Number.isNaN(expected)) {
    return fail(`element_count expected_value '${assertion.expected_value}' is not a number`);
  }
  const actual = await ctx.page.locator(assertion.selector).count();
  return actual === expected
    ? pass(`Found ${String(actual)} element(s)`, String(actual))
    : fail(`Expected ${String(expected)} element(s), found ${String(actual)}`, String(actual));
}

function checkNetworkRequestMade(
  assertion: Assertion,
  ctx: AssertionContext,
): AssertionOutcome {
  const expected = assertion.expected_value;
  if (expected === null || expected === "") {
    return fail("network_request_made requires expected_value (a URL fragment)");
  }
  if (ctx.networkLog.length === 0) {
    return fail("No network traffic was recorded");
  }
  const match = ctx.networkLog.find((entry) => entry.url.includes(expected));
  return match === undefined
    ? fail(`No request matching '${expected}' (${String(ctx.networkLog.length)} recorded)`)
    : pass(`Request matching '${expected}' was made`, match.url);
}

/**
 * Network-layer failures (a 404 favicon, a 401 analytics beacon, a CORS-blocked
 * third-party telemetry POST) surface as console errors but are network
 * results, not page-script faults — and they are common enough on real sites
 * to make this assertion useless if counted. They are excluded but reported in
 * the message, never dropped silently (plan §10); `response_status` and
 * `network_request_made` are the assertions that judge network behaviour.
 *
 * The line is deliberately drawn at "the page's own script misbehaved":
 * uncaught exceptions and rejections always count.
 */
function isResourceLoadNoise(line: string): boolean {
  return (
    line.includes("Failed to load resource") ||
    line.includes("has been blocked by CORS policy") ||
    line.toLowerCase().includes("favicon")
  );
}

function checkNoConsoleErrors(ctx: AssertionContext): AssertionOutcome {
  // Console messages are recorded as `[<type>] <text>`; the type is the
  // reliable signal, not the word "error" appearing somewhere in the text.
  const allErrors = ctx.consoleLogs.filter((line) => line.startsWith("[error]"));
  const errors = allErrors.filter((line) => !isResourceLoadNoise(line));
  const noiseCount = allErrors.length - errors.length;
  const noiseNote =
    noiseCount === 0 ? "" : ` (${String(noiseCount)} resource-load error(s) excluded)`;

  return errors.length === 0
    ? pass(`No console errors${noiseNote}`, String(allErrors.length))
    : fail(
        `${String(errors.length)} console error(s)${noiseNote}: ${errors[0]?.slice(0, 160) ?? ""}`,
        String(allErrors.length),
      );
}

function checkResponseStatus(assertion: Assertion, ctx: AssertionContext): AssertionOutcome {
  if (assertion.expected_value === null) {
    return fail("response_status requires expected_value");
  }
  const expected = Number.parseInt(assertion.expected_value, 10);
  if (Number.isNaN(expected)) {
    return fail(`response_status expected_value '${assertion.expected_value}' is not a number`);
  }
  // A selector, when present, narrows which request the status must belong to.
  const candidates =
    assertion.selector === null || assertion.selector === ""
      ? ctx.networkLog
      : ctx.networkLog.filter((entry) => entry.url.includes(assertion.selector ?? ""));
  const match = candidates.find((entry) => entry.status === expected);
  return match === undefined
    ? fail(`No response with status ${String(expected)}`)
    : pass(`Response ${String(expected)} from ${match.url}`, String(match.status));
}

async function checkPageTitleContains(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const expected = assertion.expected_value;
  if (expected === null || expected === "") {
    return fail("page_title_contains requires expected_value");
  }
  const title = await ctx.page.title();
  return title.toLowerCase().includes(expected.toLowerCase())
    ? pass(`Title contains '${expected}'`, title)
    : fail(`Title '${title}' does not contain '${expected}'`, title);
}

async function checkPageLoaded(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const title = await ctx.page.title();
  const bodyText = ((await ctx.page.locator("body").textContent()) ?? "").trim();
  if (title === "" && bodyText === "") {
    return fail("Page appears blank (no title, no body text)");
  }
  if (assertion.selector !== null && assertion.selector !== "") {
    try {
      await ctx.page
        .locator(assertion.selector)
        .first()
        .waitFor({ state: "visible", timeout: ctx.timeoutMs });
    } catch {
      return fail(`Page loaded but key element '${assertion.selector}' is not visible`, title);
    }
  }
  return pass(`Page loaded (title: '${title.slice(0, 60)}')`, title);
}

async function checkAiEvaluate(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  const intent = assertion.expected_value;
  if (intent === null || intent === "") {
    return fail("ai_evaluate requires expected_value (the intent to judge)");
  }
  if (ctx.llm === undefined) {
    return fail("ai_evaluate requires an LLM provider but none is attached");
  }

  const screenshotPath = join(ctx.evidenceDir, "ai-evaluate.png");
  try {
    await ctx.page.screenshot({ path: screenshotPath });
    const pageText =
      assertion.selector === null || assertion.selector === ""
        ? ((await ctx.page.locator("body").textContent()) ?? "")
        : await textForSelector(ctx, assertion.selector);

    const verdict = await ctx.llm.completeJson(
      {
        purpose: "ai-evaluate",
        system: AI_EVALUATE_SYSTEM_PROMPT,
        prompt:
          `## Intent to verify\n\n${intent}\n\n` +
          `## Current URL\n\n${ctx.page.url()}\n\n` +
          `## Page text (excerpt)\n\n${pageText.slice(0, 3000)}\n\n` +
          `Read and examine the screenshot at ${screenshotPath}, then return your verdict.`,
        imagePaths: [screenshotPath],
      },
      AiVerdictSchema,
    );

    const confidencePct = `${String(Math.round(verdict.confidence * 100))}%`;
    if (verdict.verdict && verdict.confidence < AI_EVALUATE_CONFIDENCE_THRESHOLD) {
      return {
        status: "fail",
        message: `AI passed with low confidence (${confidencePct}): ${verdict.reasoning}`,
        actualValue: verdict.reasoning,
        screenshots: [screenshotPath],
      };
    }
    return {
      status: verdict.verdict ? "pass" : "fail",
      message: `AI verdict (${confidencePct}): ${verdict.reasoning}`,
      actualValue: verdict.reasoning,
      screenshots: [screenshotPath],
    };
  } catch (error) {
    ctx.logger.warn(`ai_evaluate failed for intent '${intent}': ${String(error)}`);
    return fail(`AI evaluation error: ${String(error)}`);
  }
}

/** Evaluate one assertion against the current page state. Never throws. */
export async function checkAssertion(
  assertion: Assertion,
  ctx: AssertionContext,
): Promise<AssertionOutcome> {
  ctx.logger.debug(
    `assertion ${assertion.assertion_type} selector=${assertion.selector ?? "-"} ${assertion.description}`,
  );
  try {
    switch (assertion.assertion_type) {
      case "element_visible":
        return await checkElementVisible(assertion, ctx);
      case "element_hidden":
        return await checkElementHidden(assertion, ctx);
      case "text_contains":
        return await checkTextContains(assertion, ctx);
      case "text_equals":
        return await checkTextEquals(assertion, ctx);
      case "text_matches":
        return await checkTextMatches(assertion, ctx);
      case "url_matches":
        return checkUrlMatches(assertion, ctx);
      case "element_count":
        return await checkElementCount(assertion, ctx);
      case "network_request_made":
        return checkNetworkRequestMade(assertion, ctx);
      case "no_console_errors":
        return checkNoConsoleErrors(ctx);
      case "response_status":
        return checkResponseStatus(assertion, ctx);
      case "page_title_contains":
        return await checkPageTitleContains(assertion, ctx);
      case "page_loaded":
        return await checkPageLoaded(assertion, ctx);
      case "ai_evaluate":
        return await checkAiEvaluate(assertion, ctx);
      case "screenshot_diff":
        return {
          status: "skip",
          message:
            "SKIPPED — screenshot_diff is not implemented in v1; visual testing is deferred (plan §10).",
        };
    }
  } catch (error) {
    return fail(`Assertion error: ${String(error)}`);
  }
}
