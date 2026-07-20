/**
 * Single test-case execution (plan §6.3). Runs preconditions, steps and
 * assertions on a page in an isolated BrowserContext, recording a fully
 * detailed TestResult.
 *
 * Recovery order for a failed step — cheapest and most deterministic first:
 *   1. tier-1 selector healing (inside the action runner);
 *   2. session-guard re-auth + one retry, when the session looks invalidated;
 *   3. tier-2 AI fallback (budgeted), which may retry / adapt / skip / abort.
 * Every recovery decision lands in an artifact field (plan §10).
 */

import type { BrowserContext, Page } from "playwright";

import type { SessionGuard } from "../core/auth/session-guard.js";
import { pageIdFromUrl } from "../core/ids.js";
import type { Logger } from "../core/logger.js";
import type { LLMProvider } from "../llm/types.js";
import type { ElementModel } from "../schemas/site-model.js";
import type {
  AssertionResult,
  StepResult,
  TestResult,
  FallbackRecord,
} from "../schemas/run-result.js";
import type { Action, TestCase } from "../schemas/test-plan.js";
import { runAction, type ActionRunOptions } from "./action-runner.js";
import { checkAssertion } from "./assertions.js";
import { EvidenceCollector } from "./evidence.js";
import { LlmFallbackHandler, withSelector } from "./llm-fallback.js";
import { maskSecrets } from "./placeholders.js";

export interface RunTestCaseOptions {
  context: BrowserContext;
  /** Placeholder-resolved test case. */
  testCase: TestCase;
  /** SiteModel elements for the test's target page — tier-1 healing input. */
  siteElements: readonly ElementModel[];
  evidenceDir: string;
  selectorTimeoutMs: number;
  maxFallbackCalls: number;
  secrets: readonly string[];
  logger: Logger;
  llm?: LLMProvider | undefined;
  sessionGuard?: SessionGuard | undefined;
  /** Session generation observed when this test's context was created. */
  sessionGeneration: number;
}

function isHttpUrl(url: string): boolean {
  return url.startsWith("http://") || url.startsWith("https://");
}

function stepResult(
  index: number,
  action: Action,
  status: StepResult["status"],
  extra: {
    selector?: string | null;
    description?: string;
    errorMessage?: string | null;
    screenshotPath?: string | null;
  } = {},
): StepResult {
  return {
    step_index: index,
    action_type: action.action_type,
    selector: extra.selector ?? action.selector,
    value: action.value,
    description: extra.description ?? action.description,
    status,
    error_message: extra.errorMessage ?? null,
    screenshot_path: extra.screenshotPath ?? null,
  };
}

/** Execute one test case end to end. Never throws — crashes become `error`. */
export async function runTestCase(options: RunTestCaseOptions): Promise<TestResult> {
  const { testCase, logger, secrets } = options;
  const startedAt = Date.now();
  const evidence = new EvidenceCollector(options.evidenceDir, logger, secrets);

  const fallbackHandler =
    options.llm !== undefined && options.maxFallbackCalls > 0
      ? new LlmFallbackHandler(options.llm, options.maxFallbackCalls, logger)
      : null;

  const fallbackRecords: FallbackRecord[] = [];
  const preconditionResults: StepResult[] = [];
  const stepResults: StepResult[] = [];
  const assertionResults: AssertionResult[] = [];

  const page: Page = await options.context.newPage();
  evidence.attach(page);

  const actionOptions = (smartResolve: boolean): ActionRunOptions => ({
    page,
    timeoutMs: options.selectorTimeoutMs,
    elements: options.siteElements,
    logger,
    smartResolve,
    secrets,
  });

  const baseResult = {
    test_id: testCase.test_id,
    test_name: testCase.name,
    description: testCase.description,
    category: testCase.category,
    priority: testCase.priority,
    target_page_id: testCase.target_page_id,
    coverage_signature: testCase.coverage_signature,
    potentially_flaky: false,
  } as const;

  try {
    // === Preconditions === failures are recorded but never abort the test.
    for (const [index, action] of testCase.preconditions.entries()) {
      try {
        const outcome = await runAction(action, actionOptions(true));
        preconditionResults.push(
          stepResult(index, action, "pass", {
            selector: outcome.effectiveSelector === "" ? action.selector : outcome.effectiveSelector,
            screenshotPath: await evidence.screenshot(page, `precondition-${String(index)}`),
          }),
        );
      } catch (error) {
        const message = maskSecrets(String(error), secrets);
        logger.warn(`Precondition ${String(index)} failed: ${message}`);
        preconditionResults.push(
          stepResult(index, action, "fail", {
            errorMessage: message,
            screenshotPath: await evidence.screenshot(page, `precondition-${String(index)}-fail`),
          }),
        );
      }
    }

    // === Steps ===
    let aborted = false;
    let abortReason = "";
    for (const [index, action] of testCase.steps.entries()) {
      if (aborted) {
        stepResults.push(
          stepResult(index, action, "skip", { errorMessage: "Skipped after an earlier abort" }),
        );
        continue;
      }

      try {
        const outcome = await runAction(action, actionOptions(true));
        stepResults.push(
          stepResult(index, action, "pass", {
            selector: outcome.effectiveSelector === "" ? action.selector : outcome.effectiveSelector,
            description:
              outcome.strategy === "original" || outcome.strategy === "none"
                ? action.description
                : `${action.description} (tier-1 heal via ${outcome.strategy})`,
            screenshotPath: await evidence.screenshot(page, `step-${String(index)}`),
          }),
        );
        continue;
      } catch (error) {
        const message = maskSecrets(String(error), secrets);
        const failureScreenshot = await evidence.screenshot(page, `step-${String(index)}-fail`);

        // --- Recovery 2: session re-auth + one retry. ---
        if (
          testCase.requires_auth &&
          options.sessionGuard !== undefined &&
          (await options.sessionGuard.isSessionInvalidated(page))
        ) {
          logger.warn(`Step ${String(index)} failed with an invalidated session — re-authenticating.`);
          const reauthed = await options.sessionGuard.reauthenticate(
            options.sessionGeneration,
            `test ${testCase.test_id} step ${String(index)}`,
          );
          if (reauthed) {
            await options.sessionGuard.applyToLiveContext(options.context, page);
            try {
              const outcome = await runAction(action, actionOptions(true));
              stepResults.push(
                stepResult(index, action, "pass", {
                  selector:
                    outcome.effectiveSelector === "" ? action.selector : outcome.effectiveSelector,
                  description: `${action.description} (retried after re-authentication)`,
                  screenshotPath: await evidence.screenshot(page, `step-${String(index)}-reauth`),
                }),
              );
              continue;
            } catch (retryError) {
              logger.debug(`Retry after re-auth failed: ${maskSecrets(String(retryError), secrets)}`);
            }
          }
        }

        // --- Recovery 3: budgeted AI fallback. ---
        let recovered = false;
        if (fallbackHandler !== null && fallbackHandler.budgetRemaining > 0) {
          let domExcerpt = "";
          try {
            domExcerpt = maskSecrets(await page.content(), secrets);
          } catch {
            // A crashed page has no content — the model still gets the error.
          }
          const response = await fallbackHandler.request({
            testName: testCase.name,
            stepIndex: index,
            stepDescription: action.description,
            originalSelector: action.selector ?? "",
            actionType: action.action_type,
            errorMessage: message,
            currentUrl: page.url(),
            domExcerpt,
            consoleErrors: evidence.consoleErrors().slice(-5),
            ...(failureScreenshot === null ? {} : { screenshotPath: failureScreenshot }),
          });
          fallbackRecords.push(
            LlmFallbackHandler.toRecord(index, action.selector ?? "", response),
          );

          if (response.decision === "retry" && response.new_selector !== null) {
            try {
              // smartResolve off: the model's selector must stand on its own.
              await runAction(withSelector(action, response.new_selector), actionOptions(false));
              stepResults.push(
                stepResult(index, action, "pass", {
                  selector: response.new_selector,
                  description: `${action.description} (tier-2 heal: ${response.reasoning})`,
                  screenshotPath: await evidence.screenshot(page, `step-${String(index)}-retry`),
                }),
              );
              recovered = true;
            } catch (retryError) {
              logger.debug(`AI retry failed: ${maskSecrets(String(retryError), secrets)}`);
            }
          } else if (response.decision === "adapt" && response.new_action !== null) {
            try {
              await runAction(response.new_action, actionOptions(false));
              await runAction(action, actionOptions(true));
              stepResults.push(
                stepResult(index, action, "pass", {
                  description: `${action.description} (tier-2 adapt: ${response.reasoning})`,
                  screenshotPath: await evidence.screenshot(page, `step-${String(index)}-adapt`),
                }),
              );
              recovered = true;
            } catch (adaptError) {
              logger.debug(`AI adapt failed: ${maskSecrets(String(adaptError), secrets)}`);
            }
          } else if (response.decision === "abort") {
            aborted = true;
            abortReason = response.reasoning;
          }
        }

        if (!recovered) {
          stepResults.push(
            stepResult(index, action, "fail", {
              errorMessage: aborted ? `Aborted: ${abortReason} (after: ${message})` : message,
              screenshotPath: failureScreenshot,
            }),
          );
        }
      }
    }

    // Attribute coverage to where the browser ACTUALLY ended up, not to the
    // page the plan started from (plan §6.3).
    const currentUrl = page.url();
    const actualPageId = isHttpUrl(currentUrl) ? pageIdFromUrl(currentUrl) : testCase.target_page_id;
    if (testCase.target_page_id !== "" && actualPageId !== testCase.target_page_id) {
      logger.info(
        `Test navigated: target_page_id=${testCase.target_page_id} -> actual ${actualPageId} (${currentUrl})`,
      );
    }

    // === Assertions ===
    let passedCount = 0;
    let failedCount = 0;
    const failureReasons: string[] = [];

    for (const assertion of testCase.assertions) {
      const outcome = await checkAssertion(assertion, {
        page,
        evidenceDir: options.evidenceDir,
        consoleLogs: evidence.consoleLogs,
        networkLog: evidence.networkLog,
        logger,
        llm: options.llm,
        timeoutMs: options.selectorTimeoutMs,
      });
      for (const shot of outcome.screenshots ?? []) {
        evidence.addScreenshot(shot);
      }
      assertionResults.push({
        assertion_type: assertion.assertion_type,
        selector: assertion.selector,
        expected_value: assertion.expected_value,
        description: assertion.description,
        passed: outcome.status === "pass",
        actual_value: outcome.actualValue ?? null,
        message: maskSecrets(outcome.message, secrets),
      });

      if (outcome.status === "pass") {
        passedCount++;
      } else if (outcome.status === "fail") {
        failedCount++;
        failureReasons.push(
          `${assertion.description || assertion.assertion_type}: ${maskSecrets(outcome.message, secrets)}`,
        );
      } else {
        logger.warn(`Assertion ${assertion.assertion_type} skipped: ${outcome.message}`);
      }
    }

    const finalShot = await evidence.screenshot(page, "final");
    if (finalShot === null) {
      logger.debug("Final screenshot could not be captured.");
    }
    if (failedCount > 0 || aborted) {
      await evidence.captureDomSnapshot(page);
    }

    let result: TestResult["result"];
    if (aborted && failedCount === 0) {
      result = "error";
      failureReasons.push(`Aborted: ${abortReason}`);
    } else {
      result = failedCount === 0 && !aborted ? "pass" : "fail";
    }

    return {
      ...baseResult,
      actual_page_id: actualPageId,
      actual_url: isHttpUrl(currentUrl) ? currentUrl : "",
      result,
      duration_seconds: Math.round((Date.now() - startedAt) / 10) / 100,
      failure_reason: failureReasons.length === 0 ? null : failureReasons.join("; "),
      evidence: evidence.finalize(),
      fallback_records: fallbackRecords,
      precondition_results: preconditionResults,
      step_results: stepResults,
      assertion_results: assertionResults,
      assertions_passed: passedCount,
      assertions_failed: failedCount,
      assertions_total: testCase.assertions.length,
    };
  } catch (error) {
    const message = maskSecrets(String(error), secrets);
    logger.error(`Test ${testCase.test_id} crashed: ${message}`);
    return {
      ...baseResult,
      actual_page_id: testCase.target_page_id,
      actual_url: "",
      result: "error",
      duration_seconds: Math.round((Date.now() - startedAt) / 10) / 100,
      failure_reason: message,
      evidence: evidence.finalize(),
      fallback_records: fallbackRecords,
      precondition_results: preconditionResults,
      step_results: stepResults,
      assertion_results: assertionResults,
      assertions_passed: 0,
      assertions_failed: 0,
      assertions_total: testCase.assertions.length,
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}
