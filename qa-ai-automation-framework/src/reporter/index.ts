/**
 * Reporting orchestration (plan §6.3): AI summary (template fallback) →
 * regression detection against the previous run → HTML + JSON reports into
 * `runs/run-<ts>/report/`.
 *
 * Shared infrastructure (src/reporter) — importable by any component.
 */

import { join } from "node:path";

import type { Logger } from "../core/logger.js";
import type { LLMProvider } from "../llm/types.js";
import type { Workspace } from "../core/workspace.js";
import { coverageSummary } from "../coverage/scorer.js";
import type { CoverageRegistry } from "../schemas/coverage.js";
import type { RunResult } from "../schemas/run-result.js";
import { generateRunSummary } from "./ai-summary.js";
import { writeHtmlReport } from "./html-report.js";
import { writeJsonReport } from "./json-report.js";
import { detectRegressions, loadPreviousRunResult, type Regression } from "./regression-detector.js";

export interface GenerateReportsOptions {
  workspace: Workspace;
  logger: Logger;
  /** Absolute run directory (`.qa/runs/run-<ts>`). */
  runDir: string;
  registry?: CoverageRegistry | undefined;
  llm?: LLMProvider | undefined;
}

export interface GeneratedReports {
  htmlPath: string;
  jsonPath: string;
  regressions: Regression[];
  /** The summary written onto the RunResult. */
  summary: string;
}

/**
 * Generate both reports. Mutates `runResult.ai_summary` in place so the caller
 * persists the same summary into `run-result.json`.
 */
export async function generateReports(
  runResult: RunResult,
  options: GenerateReportsOptions,
): Promise<GeneratedReports> {
  const { logger } = options;
  const coverageText =
    options.registry === undefined ? undefined : coverageSummary(options.registry);

  if (runResult.ai_summary === "") {
    runResult.ai_summary = await generateRunSummary(runResult, {
      llm: options.llm,
      logger,
      coverageText,
    });
  }

  const previous = loadPreviousRunResult(options.workspace, runResult.run_id);
  const regressions = previous === null ? [] : detectRegressions(previous, runResult);
  if (previous === null) {
    logger.info("No previous run found — skipping regression detection.");
  } else if (regressions.length > 0) {
    logger.warn(
      `Detected ${String(regressions.length)} regression(s) against run ${previous.run_id}: ` +
        regressions.map((regression) => regression.test_name).join(", "),
    );
  } else {
    logger.info(`No regressions against run ${previous.run_id}.`);
  }

  const reportDir = join(options.runDir, "report");
  const htmlPath = writeHtmlReport(
    { runResult, regressions, registry: options.registry, coverageText },
    join(reportDir, "report.html"),
  );
  const jsonPath = writeJsonReport(
    { runResult, regressions, registry: options.registry },
    join(reportDir, "report.json"),
  );

  return { htmlPath, jsonPath, regressions, summary: runResult.ai_summary };
}
