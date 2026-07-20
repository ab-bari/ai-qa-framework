/**
 * Coverage registry IO (plan §6.2, §6.3, §3).
 *
 * Read path (Phase 3): load an existing registry, or synthesize an empty one
 * so the planner can run on a first pass with no history.
 * Write path (Phase 4): fold a RunResult into the registry and persist it, so
 * the next `qa-ai plan` sees real gap feedback. Port of the Python
 * `src/coverage/registry.py`.
 *
 * Shared infrastructure (src/coverage) — importable by any component.
 */

import { existsSync } from "node:fs";

import { readArtifact, writeArtifact } from "../core/artifacts.js";
import {
  CoverageRegistrySchema,
  type CategoryCoverage,
  type CoverageRegistry,
  type PageCoverage,
  type SignatureRecord,
  type TestResultSummary,
} from "../schemas/coverage.js";
import type { RunResult } from "../schemas/run-result.js";
import type { SiteModel } from "../schemas/site-model.js";

/** An empty registry for a target URL — every page reads as untested. */
export function emptyRegistry(targetUrl: string): CoverageRegistry {
  return CoverageRegistrySchema.parse({ target_url: targetUrl });
}

/**
 * Load the coverage registry from `path` when it exists (schema-validated),
 * otherwise return an empty registry for `targetUrl`. A missing registry is a
 * normal first-run condition, never an error.
 */
export function loadCoverageRegistry(path: string, targetUrl: string): CoverageRegistry {
  if (!existsSync(path)) {
    return emptyRegistry(targetUrl);
  }
  return readArtifact(CoverageRegistrySchema, path, "coverage-registry");
}

export interface UpdateRegistryOptions {
  /** Page url/type metadata for pages the registry has not seen before. */
  siteModel?: SiteModel | undefined;
  /** Runs of history kept per signature (config.history_retention_runs). */
  historyRetention?: number | undefined;
  /** Timestamp stamped on the updated records. */
  now?: Date | undefined;
}

/**
 * Fold a RunResult into the registry, returning a NEW registry (the input is
 * not mutated). Coverage is attributed to `actual_page_id` — where the browser
 * actually ended up — so a login test that lands on the dashboard credits the
 * dashboard (plan §6.3).
 */
export function updateRegistryFromRun(
  registry: CoverageRegistry,
  runResult: RunResult,
  options: UpdateRegistryOptions = {},
): CoverageRegistry {
  const timestamp = (options.now ?? new Date()).toISOString();
  const retention = options.historyRetention ?? 20;
  const pageMeta = new Map(
    (options.siteModel?.pages ?? []).map((page) => [page.page_id, page] as const),
  );

  // Structured clone keeps this function pure without hand-written deep copies.
  const next: CoverageRegistry = structuredClone(registry);

  for (const testResult of runResult.test_results) {
    const pageId =
      testResult.actual_page_id !== ""
        ? testResult.actual_page_id
        : testResult.target_page_id !== ""
          ? testResult.target_page_id
          : testResult.test_id;

    let pageCoverage: PageCoverage | undefined = next.pages[pageId];
    if (pageCoverage === undefined) {
      const meta = pageMeta.get(pageId);
      pageCoverage = {
        page_id: pageId,
        url: meta?.url ?? testResult.actual_url,
        page_type: meta?.page_type ?? "",
        categories: {},
        elements_tested: {},
        last_tested: "",
        test_count: 0,
      };
      next.pages[pageId] = pageCoverage;
    }
    pageCoverage.last_tested = timestamp;
    pageCoverage.test_count += 1;

    const category = testResult.category;
    let categoryCoverage: CategoryCoverage | undefined = pageCoverage.categories[category];
    if (categoryCoverage === undefined) {
      categoryCoverage = {
        category,
        signatures_tested: [],
        coverage_score: 0,
        last_tested: "",
      };
      pageCoverage.categories[category] = categoryCoverage;
    }
    categoryCoverage.last_tested = timestamp;

    const signature =
      testResult.coverage_signature !== "" ? testResult.coverage_signature : testResult.test_name;
    const summary: TestResultSummary = {
      run_id: runResult.run_id,
      timestamp,
      result: testResult.result,
      duration_seconds: testResult.duration_seconds,
      failure_reason: testResult.failure_reason,
    };

    const existing: SignatureRecord | undefined = categoryCoverage.signatures_tested.find(
      (record) => record.signature === signature,
    );
    if (existing === undefined) {
      categoryCoverage.signatures_tested.push({
        signature,
        last_tested: timestamp,
        last_result: testResult.result,
        test_count: 1,
        history: [summary],
      });
    } else {
      existing.last_tested = timestamp;
      existing.last_result = testResult.result;
      existing.test_count += 1;
      existing.history.push(summary);
      if (existing.history.length > retention) {
        existing.history = existing.history.slice(-retention);
      }
    }
  }

  recalculateStats(next, timestamp);
  next.last_updated = timestamp;
  return next;
}

/** Recompute per-category scores, global stats and the regression count. */
function recalculateStats(registry: CoverageRegistry, timestamp: string): void {
  const pages = Object.values(registry.pages);
  const categoryTotals = new Map<string, number>();
  const categoryPageCounts = new Map<string, number>();
  let regressionCount = 0;

  for (const page of pages) {
    for (const [categoryName, category] of Object.entries(page.categories)) {
      const total = category.signatures_tested.length;
      const passed = category.signatures_tested.filter(
        (record) => record.last_result === "pass",
      ).length;
      category.coverage_score = total === 0 ? 0 : passed / total;
      categoryTotals.set(
        categoryName,
        (categoryTotals.get(categoryName) ?? 0) + category.coverage_score,
      );
      categoryPageCounts.set(categoryName, (categoryPageCounts.get(categoryName) ?? 0) + 1);

      for (const record of category.signatures_tested) {
        const history = record.history;
        if (history.length >= 2) {
          const previous = history[history.length - 2];
          const current = history[history.length - 1];
          if (previous?.result === "pass" && current?.result === "fail") {
            regressionCount++;
          }
        }
      }
    }
  }

  const categoryScores: Record<string, number> = {};
  for (const [categoryName, total] of categoryTotals) {
    const pageCount = categoryPageCounts.get(categoryName) ?? 0;
    categoryScores[categoryName] =
      pageCount === 0 ? 0 : Math.round((total / pageCount) * 1000) / 1000;
  }
  const scores = Object.values(categoryScores);
  const overall =
    scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + score, 0) / scores.length;

  registry.global_stats = {
    total_pages: pages.length,
    pages_tested: pages.filter((page) => page.test_count > 0).length,
    overall_score: Math.round(overall * 1000) / 1000,
    category_scores: categoryScores,
    last_full_run: timestamp,
    regression_count: regressionCount,
  };
}

/** Persist the registry as a schema-validated artifact. Returns its path. */
export function saveCoverageRegistry(registry: CoverageRegistry, path: string): string {
  return writeArtifact({
    schema: CoverageRegistrySchema,
    kind: "coverage-registry",
    path,
    data: registry,
  });
}
