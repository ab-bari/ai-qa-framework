/**
 * Regression detection (plan §6.3). Compares two runs and reports tests that
 * went pass → fail/error. Matching is by `coverage_signature` first (stable
 * across runs even when a test is renamed), falling back to test name.
 * Port of the Python `src/reporter/regression_detector.py`.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { readArtifact } from "../core/artifacts.js";
import type { Workspace } from "../core/workspace.js";
import { RunResultSchema, type RunResult, type TestResult } from "../schemas/run-result.js";

export interface Regression {
  test_id: string;
  test_name: string;
  category: string;
  coverage_signature: string;
  previous_result: string;
  current_result: string;
  failure_reason: string | null;
}

/** Tests that passed in `previous` but fail or error in `current`. */
export function detectRegressions(previous: RunResult, current: RunResult): Regression[] {
  const bySignature = new Map<string, TestResult>();
  const byName = new Map<string, TestResult>();
  for (const result of previous.test_results) {
    if (result.coverage_signature !== "") {
      bySignature.set(result.coverage_signature, result);
    }
    byName.set(result.test_name, result);
  }

  const regressions: Regression[] = [];
  for (const result of current.test_results) {
    const prior =
      (result.coverage_signature !== ""
        ? bySignature.get(result.coverage_signature)
        : undefined) ?? byName.get(result.test_name);
    if (prior?.result === "pass" && (result.result === "fail" || result.result === "error")) {
      regressions.push({
        test_id: result.test_id,
        test_name: result.test_name,
        category: result.category,
        coverage_signature: result.coverage_signature,
        previous_result: prior.result,
        current_result: result.result,
        failure_reason: result.failure_reason,
      });
    }
  }
  return regressions;
}

/**
 * Find the most recent previous run's RunResult, excluding `currentRunId`.
 * Run directories are named `run-<ts>`, so lexicographic order is chronological.
 * Returns null when there is no earlier run (a normal first-run condition).
 */
export function loadPreviousRunResult(
  workspace: Workspace,
  currentRunId: string,
): RunResult | null {
  const runsDir = workspace.runsDir;
  if (!existsSync(runsDir)) {
    return null;
  }
  const candidates = readdirSync(runsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== currentRunId)
    .map((entry) => entry.name)
    .sort()
    .reverse();

  for (const name of candidates) {
    const path = join(runsDir, name, "run-result.json");
    if (!existsSync(path)) {
      continue;
    }
    try {
      return readArtifact(RunResultSchema, path, "run-result");
    } catch {
      // A corrupt or older-schema run must not break the current report.
      continue;
    }
  }
  return null;
}
