/**
 * Coverage scoring summaries (plan §3 coverage/scorer). Port of the Python
 * `src/coverage/scorer.py`: a human-readable digest of the registry, used in
 * the executor console output, the HTML report, and the AI summary prompt.
 */

import type { CoverageRegistry } from "../schemas/coverage.js";

function percent(score: number): string {
  return `${String(Math.round(score * 100))}%`;
}

/** Multi-line, human-readable coverage summary. */
export function coverageSummary(registry: CoverageRegistry): string {
  const stats = registry.global_stats;
  const lines = [
    `Coverage summary for ${registry.target_url}`,
    `  Pages: ${String(stats.pages_tested)}/${String(stats.total_pages)} tested`,
    `  Overall score: ${percent(stats.overall_score)}`,
  ];
  for (const [category, score] of Object.entries(stats.category_scores)) {
    lines.push(`  ${category.charAt(0).toUpperCase()}${category.slice(1)}: ${percent(score)}`);
  }
  if (stats.regression_count > 0) {
    lines.push(`  Regressions: ${String(stats.regression_count)}`);
  }
  if (stats.last_full_run !== "") {
    lines.push(`  Last run: ${stats.last_full_run}`);
  }
  return lines.join("\n");
}
