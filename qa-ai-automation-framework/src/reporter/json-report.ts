/**
 * Machine-readable run report (plan §3 workspace layout:
 * `runs/run-<ts>/report/report.json`). The RunResult plus the regressions
 * detected against the previous run. The canonical artifact stays
 * `run-result.json`; this is the report-shaped view alongside the HTML.
 */

import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { atomicWriteFile } from "../core/workspace.js";
import type { CoverageRegistry } from "../schemas/coverage.js";
import type { RunResult } from "../schemas/run-result.js";
import type { Regression } from "./regression-detector.js";

export interface JsonReportInput {
  runResult: RunResult;
  regressions: readonly Regression[];
  registry?: CoverageRegistry | undefined;
}

/** Write `report.json` and return its path. */
export function writeJsonReport(input: JsonReportInput, path: string): string {
  const report = {
    ...input.runResult,
    regressions: input.regressions,
    coverage: input.registry === undefined ? null : input.registry.global_stats,
  };
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, `${JSON.stringify(report, null, 2)}\n`);
  return path;
}
