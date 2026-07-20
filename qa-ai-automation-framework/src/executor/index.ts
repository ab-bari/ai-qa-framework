/**
 * Executor orchestrator (plan §6.3). Schedules a TestPlan against a live site:
 * priority sort (ascending — 1 is critical) → semaphore bounded by
 * `max_parallel_contexts` → wall-clock budget from `max_execution_time_seconds`,
 * with tests that never started recorded as `skip` rather than dropped.
 *
 * One browser is shared; every test gets a fully isolated BrowserContext,
 * seeded with the captured storage state when the test requires auth.
 */

import { join } from "node:path";

import type { Browser } from "playwright";

import { SessionGuard } from "../core/auth/session-guard.js";
import { createStealthContext } from "../core/browser/context-factory.js";
import { launchStealthBrowser } from "../core/browser/launch-stealth-browser.js";
import { newRunId } from "../core/ids.js";
import type { RunContext } from "../core/run-context.js";
import { Semaphore } from "../core/semaphore.js";
import type { RunResult, TestResult } from "../schemas/run-result.js";
import type { SiteModel } from "../schemas/site-model.js";
import type { TestCase, TestPlan } from "../schemas/test-plan.js";
import { buildPlaceholderContext, resolveTestCase } from "./placeholders.js";
import { runTestCase } from "./test-runner.js";

export interface ExecuteOptions {
  /** Overrides `config.max_parallel_contexts`. */
  maxParallel?: number | undefined;
  /** Run Chromium headed. */
  headed?: boolean | undefined;
  /** Substring filter over test_id and name. */
  filter?: string | undefined;
  /** Explicit run id; defaults to `run-<ts>`. */
  runId?: string | undefined;
}

export interface ExecuteResult {
  runResult: RunResult;
  /** Absolute directory holding run-result.json, evidence/ and report/. */
  runDir: string;
}

function skippedResult(testCase: TestCase, reason: string): TestResult {
  return {
    test_id: testCase.test_id,
    test_name: testCase.name,
    description: testCase.description,
    category: testCase.category,
    priority: testCase.priority,
    target_page_id: testCase.target_page_id,
    actual_page_id: "",
    actual_url: "",
    coverage_signature: testCase.coverage_signature,
    result: "skip",
    duration_seconds: 0,
    failure_reason: reason,
    evidence: {
      screenshots: [],
      console_logs: [],
      network_log: [],
      dom_snapshot_path: null,
      video_path: null,
    },
    fallback_records: [],
    precondition_results: [],
    step_results: [],
    assertion_results: [],
    assertions_passed: 0,
    assertions_failed: 0,
    assertions_total: testCase.assertions.length,
    potentially_flaky: false,
  };
}

function matchesFilter(testCase: TestCase, filter: string | undefined): boolean {
  if (filter === undefined || filter === "") {
    return true;
  }
  const needle = filter.toLowerCase();
  return (
    testCase.test_id.toLowerCase().includes(needle) || testCase.name.toLowerCase().includes(needle)
  );
}

/** Execute a TestPlan and return the RunResult plus its run directory. */
export async function executePlan(
  ctx: RunContext,
  plan: TestPlan,
  siteModel: SiteModel,
  options: ExecuteOptions = {},
): Promise<ExecuteResult> {
  const { config, logger, workspace } = ctx;
  const runId = options.runId ?? newRunId();
  const runDir = workspace.ensureDir("runs", runId);
  const startedAt = new Date();
  const startMs = Date.now();
  const budgetMs = config.max_execution_time_seconds * 1000;

  const selected = plan.test_cases.filter((testCase) => matchesFilter(testCase, options.filter));
  const dropped = plan.test_cases.length - selected.length;
  if (dropped > 0) {
    logger.info(`Filter '${options.filter ?? ""}' excluded ${String(dropped)} test case(s).`);
  }
  // Priority 1 is the most critical, so ascending order runs those first.
  const ordered = [...selected].sort((a, b) => a.priority - b.priority);
  logger.info(
    `Executing plan ${plan.plan_id}: ${String(ordered.length)} test(s), ` +
      `up to ${String(options.maxParallel ?? config.max_parallel_contexts)} in parallel, ` +
      `budget ${String(config.max_execution_time_seconds)}s.`,
  );

  const elementsByPage = new Map(siteModel.pages.map((page) => [page.page_id, page.elements]));
  const placeholders = buildPlaceholderContext(config.auth);
  const secrets = placeholders.secrets;

  const browser: Browser = await launchStealthBrowser(options.headed !== true);
  let sessionGuard: SessionGuard | undefined;
  const results: TestResult[] = [];

  try {
    if (config.auth !== null) {
      sessionGuard = new SessionGuard({
        browser,
        auth: config.auth,
        storageStatePath: workspace.storageStatePath,
        logger,
        viewport: config.crawl.viewport,
        userAgent: config.crawl.user_agent,
        llm: ctx.llm,
        screenshotDir: workspace.ensureDir("debug", "auth"),
      });
      if (!(await sessionGuard.authenticate())) {
        logger.error(
          "Initial authentication failed — tests requiring auth will run unauthenticated.",
        );
      }
    }

    const semaphore = new Semaphore(options.maxParallel ?? config.max_parallel_contexts);
    const guard = sessionGuard;

    const runOne = async (testCase: TestCase, index: number): Promise<TestResult> =>
      semaphore.run(async () => {
        const elapsedMs = Date.now() - startMs;
        if (elapsedMs >= budgetMs) {
          logger.warn(`Time budget exhausted — skipping ${testCase.test_id} (${testCase.name}).`);
          return skippedResult(
            testCase,
            `Skipped: ${String(config.max_execution_time_seconds)}s execution budget exhausted`,
          );
        }

        logger.info(
          `[${String(index + 1)}/${String(ordered.length)}] ${testCase.test_id} — ${testCase.name} ` +
            `(${testCase.category}, P${String(testCase.priority)})`,
        );

        const seedPath = testCase.requires_auth ? guard?.seedPath : undefined;
        const sessionGeneration = guard?.generation ?? 0;
        const context = await createStealthContext(browser, {
          viewport: config.crawl.viewport,
          userAgent: config.crawl.user_agent,
          ...(seedPath === undefined ? {} : { storageStatePath: seedPath }),
        });

        try {
          const result = await runTestCase({
            context,
            testCase: resolveTestCase(testCase, placeholders, logger),
            siteElements: elementsByPage.get(testCase.target_page_id) ?? [],
            evidenceDir: join(runDir, "evidence", testCase.test_id),
            selectorTimeoutMs: config.selector_timeout_seconds * 1000,
            maxFallbackCalls: config.ai_max_fallback_calls_per_test,
            secrets,
            logger: logger.child(testCase.test_id),
            llm: ctx.llm,
            ...(guard === undefined ? {} : { sessionGuard: guard }),
            sessionGeneration,
          });
          logger.info(
            `[${result.result.toUpperCase()}] ${testCase.test_id} — ${testCase.name} ` +
              `(${result.duration_seconds.toFixed(1)}s, ` +
              `${String(result.assertions_passed)}/${String(result.assertions_total)} assertions)`,
          );

          // A test that logged out invalidates the shared session for others.
          if (guard !== undefined && SessionGuard.sawLogoutRequest(result.evidence.network_log)) {
            await guard.reauthenticate(sessionGeneration, `logout observed in ${testCase.test_id}`);
          }
          return result;
        } finally {
          await context.close();
        }
      });

    results.push(...(await Promise.all(ordered.map((testCase, index) => runOne(testCase, index)))));
  } finally {
    await browser.close();
  }

  const durationSeconds = (Date.now() - startMs) / 1000;
  const count = (outcome: TestResult["result"]): number =>
    results.filter((result) => result.result === outcome).length;

  const runResult: RunResult = {
    run_id: runId,
    plan_id: plan.plan_id,
    started_at: startedAt.toISOString(),
    completed_at: new Date().toISOString(),
    target_url: plan.target_url,
    total_tests: results.length,
    passed: count("pass"),
    failed: count("fail"),
    skipped: count("skip"),
    errors: count("error"),
    duration_seconds: Math.round(durationSeconds * 100) / 100,
    test_results: results,
    ai_summary: "",
  };

  logger.info(
    `Execution complete: ${String(runResult.passed)} passed, ${String(runResult.failed)} failed, ` +
      `${String(runResult.skipped)} skipped, ${String(runResult.errors)} errors ` +
      `(${durationSeconds.toFixed(1)}s).`,
  );

  return { runResult, runDir };
}
