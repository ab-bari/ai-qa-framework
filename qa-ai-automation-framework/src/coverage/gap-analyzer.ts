/**
 * Coverage gap analyzer (plan §6.2) — the read path into the coverage registry.
 * Port of the Python `src/coverage/gap_analyzer.py`: compares the site model
 * against the registry to surface untested, stale, low-coverage, and recently
 * failed areas. An empty registry is fine — every page reads as untested.
 *
 * This module is shared read infrastructure (src/coverage), so pipeline
 * components may import it without violating the component-isolation boundary.
 */

import type { CoverageGapReport, CoverageRegistry } from "../schemas/coverage.js";
import type { SiteModel } from "../schemas/site-model.js";

export interface GapAnalysisOptions {
  /** Pages not tested within this many days are flagged stale. */
  stalenessDays?: number;
  /** Category coverage below this score is flagged low-coverage. */
  lowCoverageThreshold?: number;
}

/** Parse an ISO timestamp to epoch ms, or null when unparseable/empty. */
function parseTimestamp(value: string): number | null {
  if (value === "") {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Analyze coverage gaps from the registry and site model (plan §6.2). Pure and
 * deterministic — no LLM, no IO. Mirrors the Python analyzer field-for-field.
 */
export function analyzeGaps(
  registry: CoverageRegistry,
  siteModel: SiteModel,
  options: GapAnalysisOptions = {},
): CoverageGapReport {
  const stalenessDays = options.stalenessDays ?? 7;
  const lowCoverageThreshold = options.lowCoverageThreshold ?? 0.5;
  const stalenessCutoff = Date.now() - stalenessDays * 24 * 60 * 60 * 1000;

  const untestedPages: string[] = [];
  const stalePages: string[] = [];
  const lowCoverageAreas: [string, string, number][] = [];
  const recentFailures: [string, string][] = [];

  for (const page of siteModel.pages) {
    const pid = page.page_id;
    const pageCov = registry.pages[pid];

    if (pageCov === undefined) {
      untestedPages.push(pid);
      continue;
    }

    // Staleness: never-tested or last tested before the cutoff.
    const lastTested = parseTimestamp(pageCov.last_tested);
    if (lastTested === null || lastTested < stalenessCutoff) {
      stalePages.push(pid);
    }

    // Low coverage + recent failures, per category signature.
    for (const [catName, catCov] of Object.entries(pageCov.categories)) {
      if (catCov.coverage_score < lowCoverageThreshold) {
        lowCoverageAreas.push([pid, catName, catCov.coverage_score]);
      }
      for (const sig of catCov.signatures_tested) {
        if (sig.last_result === "fail") {
          recentFailures.push([pid, sig.signature]);
        }
      }
    }
  }

  const suggestedFocus: string[] = [];
  if (untestedPages.length > 0) {
    suggestedFocus.push(`Test ${String(untestedPages.length)} untested pages`);
  }
  if (recentFailures.length > 0) {
    suggestedFocus.push(`Re-test ${String(recentFailures.length)} recent failures`);
  }
  if (stalePages.length > 0) {
    suggestedFocus.push(`Refresh ${String(stalePages.length)} stale pages`);
  }
  if (lowCoverageAreas.length > 0) {
    suggestedFocus.push(`Improve ${String(lowCoverageAreas.length)} low-coverage areas`);
  }

  return {
    untested_pages: untestedPages,
    stale_pages: stalePages,
    low_coverage_areas: lowCoverageAreas,
    recent_failures: recentFailures,
    suggested_focus: suggestedFocus,
  };
}
