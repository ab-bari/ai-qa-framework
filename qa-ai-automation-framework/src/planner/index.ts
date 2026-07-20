/**
 * Planner orchestrator (plan §6.2). Reads the SiteModel + coverage gap report,
 * summarizes the site, makes a SINGLE `completeJson` planning call, validates
 * and normalizes the returned test cases, and wraps them into a TestPlan. Any
 * LLM/JSON failure (or an empty result) falls back to the deterministic
 * planner, so `qa-ai plan` always produces a usable plan. Credentials stay as
 * placeholder tokens on disk — the executor resolves them (plan §6.2/§6.3).
 */

import { newPlanId } from "../core/ids.js";
import type { RunContext } from "../core/run-context.js";
import { analyzeGaps } from "../coverage/gap-analyzer.js";
import { loadCoverageRegistry } from "../coverage/registry.js";
import type { CoverageRegistry } from "../schemas/coverage.js";
import type { SiteModel } from "../schemas/site-model.js";
import type { TestPlan } from "../schemas/test-plan.js";
import { generateFallbackPlan } from "./fallback-planner.js";
import { RawPlanResponseSchema, validateTestCases } from "./plan-validator.js";
import { buildPlanningPrompt, PLANNING_SYSTEM_PROMPT } from "./prompts.js";
import { summarizeSiteModel } from "./site-summarizer.js";

export interface PlanOptions {
  /** Overrides `config.max_tests_per_run` when set. */
  maxTests?: number | undefined;
  /** Explicit coverage-registry path; defaults to the workspace registry (may not exist). */
  coveragePath?: string | undefined;
}

/** Category budget guidance string — ~60/40 functional/security in v1 (plan §6.2). */
function categoryBudget(categories: readonly string[]): string {
  const hasFunctional = categories.includes("functional");
  const hasSecurity = categories.includes("security");
  if (hasFunctional && hasSecurity) {
    return "Allocate roughly 60% of the budget to functional tests and 40% to security tests.";
  }
  if (hasSecurity && !hasFunctional) {
    return "Generate security tests only.";
  }
  return "Generate functional tests only.";
}

function configSummary(ctx: RunContext, maxTests: number): string {
  return (
    `Categories: ${ctx.config.categories.join(", ")}\n` +
    `Max tests: ${String(maxTests)}\n` +
    `Target URL: ${ctx.config.target_url}\n`
  );
}

/** Generate a TestPlan from the SiteModel and coverage gaps (plan §6.2). */
export async function generatePlan(
  ctx: RunContext,
  siteModel: SiteModel,
  options: PlanOptions = {},
): Promise<TestPlan> {
  const { logger } = ctx;
  const maxTests = options.maxTests ?? ctx.config.max_tests_per_run;

  const registry: CoverageRegistry = loadCoverageRegistry(
    options.coveragePath ?? ctx.workspace.coverageRegistryPath,
    siteModel.base_url,
  );
  const gapReport = analyzeGaps(registry, siteModel, {
    stalenessDays: ctx.config.staleness_threshold_days,
  });
  logger.info(
    `Coverage gaps: ${String(gapReport.untested_pages.length)} untested, ` +
      `${String(gapReport.stale_pages.length)} stale, ` +
      `${String(gapReport.recent_failures.length)} recent failures`,
  );

  if (ctx.llm === undefined) {
    logger.warn("No LLM provider available — generating deterministic fallback plan.");
    return generateFallbackPlan(siteModel, ctx.config, { maxTests });
  }

  const summary = summarizeSiteModel(siteModel, gapReport);
  const prompt = buildPlanningPrompt({
    siteSummaryJson: summary,
    gapReportJson: JSON.stringify(gapReport, null, 2),
    configSummary: configSummary(ctx, maxTests),
    categoryBudget: categoryBudget(ctx.config.categories),
    hints: ctx.config.hints,
    maxTests,
  });

  try {
    logger.info("Requesting AI-generated test plan...");
    const raw = await ctx.llm.completeJson(
      { purpose: "planner", prompt, system: PLANNING_SYSTEM_PROMPT },
      RawPlanResponseSchema,
    );

    const { testCases, dropped } = validateTestCases(raw.test_cases, ctx.config);
    for (const drop of dropped) {
      logger.warn(`Dropped test case ${drop.test_id} (index ${String(drop.index)}): ${drop.reason}`);
    }
    if (testCases.length === 0) {
      logger.warn("AI plan produced no valid test cases — falling back to deterministic plan.");
      return generateFallbackPlan(siteModel, ctx.config, { maxTests });
    }

    const capped = testCases.slice(0, maxTests);
    if (capped.length < testCases.length) {
      logger.info(`Capped plan to ${String(maxTests)} test cases (had ${String(testCases.length)}).`);
    }

    const coverageIntent: Record<string, unknown> = {
      ...(raw.coverage_intent ?? {}),
      fallback: false,
      requested_categories: ctx.config.categories,
    };

    logger.info(`Generated plan with ${String(capped.length)} test cases.`);
    return {
      plan_id: raw.plan_id ?? newPlanId(),
      generated_at: new Date().toISOString(),
      target_url: siteModel.base_url,
      test_cases: capped,
      estimated_duration_seconds: raw.estimated_duration_seconds ?? capped.length * 15,
      coverage_intent: coverageIntent,
    };
  } catch (error) {
    logger.error(`AI planning failed: ${String(error)}. Generating fallback plan.`);
    return generateFallbackPlan(siteModel, ctx.config, { maxTests });
  }
}
