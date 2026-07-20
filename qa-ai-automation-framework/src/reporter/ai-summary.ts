/**
 * Run summary generation (plan §6.3). Asks the model for a concise, actionable
 * summary of the run, and falls back to a deterministic template whenever no
 * provider is attached or the call fails — a report is never blocked on the AI.
 */

import type { Logger } from "../core/logger.js";
import type { LLMProvider } from "../llm/types.js";
import type { RunResult } from "../schemas/run-result.js";

export const SUMMARY_SYSTEM_PROMPT = `You are an expert QA engineer. Given the results of an automated test run, write a concise, actionable summary covering:

1. Overall health: how many tests passed, failed, were skipped or errored.
2. Key failures: what broke and the likely root causes.
3. Security findings: any security-category issues discovered.
4. Coverage: what the run did and did not exercise.
5. Recommendations: what to investigate or fix first.

Be concise but specific — reference test names and pages. Write 3-8 sentences of plain prose, no markdown headings or bullet lists.`;

export function buildSummaryPrompt(resultsJson: string, coverageText: string): string {
  return (
    `## Test run results\n\n\`\`\`json\n${resultsJson}\n\`\`\`\n\n` +
    `## Coverage summary\n\n${coverageText}\n\n` +
    `Write the summary now.`
  );
}

/** Deterministic summary used when the AI is unavailable or fails. */
export function templateSummary(runResult: RunResult): string {
  const parts = [
    `Tested ${runResult.target_url}: ${String(runResult.total_tests)} tests in ${runResult.duration_seconds.toFixed(1)}s.`,
    `Results: ${String(runResult.passed)} passed, ${String(runResult.failed)} failed, ` +
      `${String(runResult.skipped)} skipped, ${String(runResult.errors)} errors.`,
  ];
  const failures = runResult.test_results.filter(
    (result) => result.result === "fail" || result.result === "error",
  );
  if (failures.length > 0) {
    parts.push(
      `Key failures: ${failures
        .slice(0, 5)
        .map((result) => result.test_name)
        .join(", ")}.`,
    );
  }
  return parts.join(" ");
}

export interface SummaryOptions {
  llm?: LLMProvider | undefined;
  logger: Logger;
  coverageText?: string | undefined;
}

/** Generate the run summary, falling back to the template on any failure. */
export async function generateRunSummary(
  runResult: RunResult,
  options: SummaryOptions,
): Promise<string> {
  if (options.llm === undefined) {
    return templateSummary(runResult);
  }
  // Send a digest, never the whole RunResult — evidence blobs would dwarf it.
  const digest = {
    run_id: runResult.run_id,
    target_url: runResult.target_url,
    total: runResult.total_tests,
    passed: runResult.passed,
    failed: runResult.failed,
    skipped: runResult.skipped,
    errors: runResult.errors,
    duration_seconds: runResult.duration_seconds,
    failures: runResult.test_results
      .filter((result) => result.result === "fail" || result.result === "error")
      .slice(0, 20)
      .map((result) => ({
        name: result.test_name,
        category: result.category,
        page: result.actual_page_id,
        reason: result.failure_reason,
      })),
  };

  try {
    const response = await options.llm.complete({
      purpose: "summary",
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: buildSummaryPrompt(JSON.stringify(digest, null, 2), options.coverageText ?? ""),
    });
    const text = response.text.trim();
    return text === "" ? templateSummary(runResult) : text;
  } catch (error) {
    options.logger.warn(`AI summary generation failed: ${String(error)} — using template summary.`);
    return templateSummary(runResult);
  }
}
