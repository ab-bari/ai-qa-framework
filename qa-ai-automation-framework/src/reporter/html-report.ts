/**
 * Self-contained HTML run report (plan §6.3): summary stats, regressions,
 * coverage, and a per-test expandable card with steps, assertions, AI fallback
 * decisions and base64-embedded screenshots. One file, no external assets, so
 * it can be attached to a ticket or emailed as-is.
 */

import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname } from "node:path";

import { atomicWriteFile } from "../core/workspace.js";
import type { CoverageRegistry } from "../schemas/coverage.js";
import type { AssertionResult, RunResult, StepResult, TestResult } from "../schemas/run-result.js";
import type { Regression } from "./regression-detector.js";

/** Screenshots larger than this are linked by path instead of embedded. */
const MAX_EMBED_BYTES = 2_000_000;
/** Cap embedded screenshots per test so reports stay openable. */
const MAX_EMBEDS_PER_TEST = 12;

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Read an image as a data URI, or null when unreadable/too large. */
function embedImage(path: string): string | null {
  try {
    const stats = statSync(path);
    if (!stats.isFile() || stats.size === 0 || stats.size > MAX_EMBED_BYTES) {
      return null;
    }
    const mime = MIME_BY_EXT[extname(path).toLowerCase()] ?? "image/png";
    return `data:${mime};base64,${readFileSync(path).toString("base64")}`;
  } catch {
    return null;
  }
}

function statusIcon(status: string): string {
  if (status === "pass") {
    return '<span class="icon pass">&#10003;</span>';
  }
  if (status === "fail" || status === "error") {
    return '<span class="icon fail">&#10007;</span>';
  }
  return '<span class="icon skip">&#8212;</span>';
}

function renderStepRow(step: StepResult): string {
  const selector =
    step.selector === null || step.selector === ""
      ? ""
      : ` <code>${escapeHtml(step.selector)}</code>`;
  const value =
    step.value === null || step.value === ""
      ? ""
      : ` <span class="muted">value: ${escapeHtml(step.value)}</span>`;
  const error =
    step.error_message === null
      ? ""
      : `<div class="error-msg">${escapeHtml(step.error_message)}</div>`;
  return `<div class="row ${step.status}">
    ${statusIcon(step.status)}
    <div class="row-body">
      <div><strong>${escapeHtml(step.action_type)}</strong>${selector}${value}</div>
      ${step.description === "" ? "" : `<div class="muted">${escapeHtml(step.description)}</div>`}
      ${error}
    </div>
  </div>`;
}

function renderAssertionRow(assertion: AssertionResult): string {
  const skipped = assertion.message.startsWith("SKIPPED");
  const status = skipped ? "skip" : assertion.passed ? "pass" : "fail";
  const expected =
    assertion.expected_value === null || assertion.expected_value === ""
      ? ""
      : ` <span class="muted">expected: ${escapeHtml(assertion.expected_value)}</span>`;
  const actual =
    assertion.actual_value === null || assertion.actual_value === ""
      ? ""
      : `<div class="muted">actual: ${escapeHtml(assertion.actual_value)}</div>`;
  return `<div class="row ${status}">
    ${statusIcon(status)}
    <div class="row-body">
      <div><strong>${escapeHtml(assertion.description || assertion.assertion_type)}</strong>${expected}</div>
      ${assertion.message === "" ? "" : `<div class="muted">${escapeHtml(assertion.message)}</div>`}
      ${actual}
    </div>
  </div>`;
}

function renderTestCard(result: TestResult): string {
  const sections: string[] = [];

  if (result.description !== "") {
    sections.push(`<p class="description">${escapeHtml(result.description)}</p>`);
  }
  if (result.failure_reason !== null) {
    sections.push(
      `<div class="failure-banner"><strong>Failure:</strong> ${escapeHtml(result.failure_reason)}</div>`,
    );
  }
  if (result.precondition_results.length > 0) {
    sections.push(
      `<h4>Preconditions</h4>${result.precondition_results.map(renderStepRow).join("")}`,
    );
  }
  if (result.step_results.length > 0) {
    sections.push(`<h4>Steps</h4>${result.step_results.map(renderStepRow).join("")}`);
  }
  if (result.assertion_results.length > 0) {
    sections.push(`<h4>Assertions</h4>${result.assertion_results.map(renderAssertionRow).join("")}`);
  }
  if (result.fallback_records.length > 0) {
    const rows = result.fallback_records
      .map(
        (record) => `<div class="row skip">
          <span class="badge decision">${escapeHtml(record.decision)}</span>
          <div class="row-body">
            <div>Step ${String(record.step_index)}: <code>${escapeHtml(record.original_selector)}</code>
            ${record.new_selector === null ? "" : ` &rarr; <code>${escapeHtml(record.new_selector)}</code>`}</div>
            <div class="muted">${escapeHtml(record.reasoning)}</div>
          </div>
        </div>`,
      )
      .join("");
    sections.push(`<h4>AI fallback decisions</h4>${rows}`);
  }

  const shots: string[] = [];
  for (const path of result.evidence.screenshots.slice(0, MAX_EMBEDS_PER_TEST)) {
    const dataUri = embedImage(path);
    shots.push(
      dataUri === null
        ? `<div class="shot missing">Not embedded: <code>${escapeHtml(path)}</code></div>`
        : `<figure class="shot"><img src="${dataUri}" alt="${escapeHtml(path)}" loading="lazy"><figcaption>${escapeHtml(path.split(/[\\/]/).pop() ?? "")}</figcaption></figure>`,
    );
  }
  if (shots.length > 0) {
    const omitted = result.evidence.screenshots.length - shots.length;
    sections.push(
      `<h4>Screenshots</h4><div class="shots">${shots.join("")}</div>` +
        (omitted > 0 ? `<p class="muted">${String(omitted)} more not embedded.</p>` : ""),
    );
  }

  return `<details class="test-card ${result.result}">
    <summary>
      <span class="badge ${result.result}">${result.result.toUpperCase()}</span>
      <strong>${escapeHtml(result.test_name)}</strong>
      <span class="badge category">${escapeHtml(result.category)}</span>
      <span class="muted">P${String(result.priority)} &middot; ${result.duration_seconds.toFixed(1)}s &middot; ${String(result.assertions_passed)}/${String(result.assertions_total)} assertions</span>
    </summary>
    <div class="test-body">${sections.join("")}</div>
  </details>`;
}

function renderRegressions(regressions: readonly Regression[]): string {
  if (regressions.length === 0) {
    return "";
  }
  const rows = regressions
    .map(
      (regression) => `<tr>
        <td>${escapeHtml(regression.test_name)}</td>
        <td>${escapeHtml(regression.category)}</td>
        <td>${escapeHtml(regression.previous_result)} &rarr; ${escapeHtml(regression.current_result)}</td>
        <td>${escapeHtml(regression.failure_reason ?? "")}</td>
      </tr>`,
    )
    .join("");
  return `<section class="regressions">
    <h2>Regressions (${String(regressions.length)})</h2>
    <table><thead><tr><th>Test</th><th>Category</th><th>Change</th><th>Reason</th></tr></thead>
    <tbody>${rows}</tbody></table>
  </section>`;
}

const STYLES = `
:root { color-scheme: light dark; --pass:#22c55e; --fail:#ef4444; --skip:#eab308; --error:#f97316; }
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 2rem;
  background: #f8fafc; color: #0f172a; line-height: 1.5; }
h1 { margin: 0 0 .25rem; font-size: 1.5rem; }
h2 { font-size: 1.15rem; margin: 2rem 0 .75rem; }
h4 { margin: 1rem 0 .35rem; font-size: .9rem; text-transform: uppercase; letter-spacing: .04em; color: #475569; }
.meta { color: #64748b; font-size: .9rem; margin-bottom: 1.5rem; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: .75rem; }
.stat { background: #fff; border: 1px solid #e2e8f0; border-radius: .5rem; padding: .75rem 1rem; }
.stat .n { font-size: 1.6rem; font-weight: 700; }
.stat.pass .n { color: var(--pass); } .stat.fail .n { color: var(--fail); }
.stat.skip .n { color: var(--skip); } .stat.error .n { color: var(--error); }
.ai-summary { background: #fff; border: 1px solid #e2e8f0; border-left: 4px solid #6366f1;
  border-radius: .5rem; padding: 1rem; margin-top: 1.5rem; white-space: pre-wrap; }
pre.coverage { background: #fff; border: 1px solid #e2e8f0; border-radius: .5rem; padding: 1rem;
  overflow-x: auto; font-size: .85rem; }
table { border-collapse: collapse; width: 100%; background: #fff; font-size: .9rem; }
th, td { border: 1px solid #e2e8f0; padding: .5rem .65rem; text-align: left; vertical-align: top; }
th { background: #f1f5f9; }
.test-card { background: #fff; border: 1px solid #e2e8f0; border-radius: .5rem; margin-bottom: .6rem;
  border-left-width: 4px; }
.test-card.pass { border-left-color: var(--pass); } .test-card.fail { border-left-color: var(--fail); }
.test-card.skip { border-left-color: var(--skip); } .test-card.error { border-left-color: var(--error); }
summary { cursor: pointer; padding: .75rem 1rem; display: flex; align-items: center;
  gap: .5rem; flex-wrap: wrap; }
.test-body { padding: 0 1rem 1rem; border-top: 1px solid #f1f5f9; }
.badge { font-size: .7rem; font-weight: 700; padding: .15rem .45rem; border-radius: .25rem;
  text-transform: uppercase; letter-spacing: .03em; color: #fff; }
.badge.pass { background: var(--pass); } .badge.fail { background: var(--fail); }
.badge.skip { background: var(--skip); } .badge.error { background: var(--error); }
.badge.category, .badge.decision { background: #e2e8f0; color: #475569; }
.muted { color: #64748b; font-size: .85rem; }
.description { color: #475569; margin: .75rem 0; }
.failure-banner { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b;
  border-radius: .35rem; padding: .6rem .8rem; margin: .75rem 0; font-size: .9rem; }
.row { display: flex; gap: .5rem; padding: .35rem .5rem; border-radius: .3rem; align-items: flex-start; }
.row.fail { background: #fef2f2; } .row.skip { background: #fefce8; }
.row-body { flex: 1; min-width: 0; font-size: .88rem; }
.icon { font-weight: 700; width: 1rem; flex: none; }
.icon.pass { color: var(--pass); } .icon.fail { color: var(--fail); } .icon.skip { color: var(--skip); }
.error-msg { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .8rem;
  color: #991b1b; white-space: pre-wrap; margin-top: .25rem; }
code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .82rem;
  background: #f1f5f9; padding: .05rem .3rem; border-radius: .2rem; }
.shots { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: .75rem; }
.shot { margin: 0; } .shot img { width: 100%; border: 1px solid #e2e8f0; border-radius: .35rem; }
.shot figcaption { font-size: .75rem; color: #64748b; margin-top: .2rem; word-break: break-all; }
.shot.missing { font-size: .8rem; color: #64748b; }
@media (prefers-color-scheme: dark) {
  body { background: #0f172a; color: #e2e8f0; }
  .stat, .test-card, table, .ai-summary, pre.coverage { background: #1e293b; border-color: #334155; }
  th { background: #334155; } th, td { border-color: #334155; }
  .test-body { border-top-color: #334155; }
  code { background: #334155; } .row.fail { background: #451a1a; } .row.skip { background: #423806; }
  .failure-banner { background: #451a1a; border-color: #7f1d1d; color: #fca5a5; }
  .muted, .description, h4 { color: #94a3b8; } .badge.category, .badge.decision { background: #334155; color: #cbd5e1; }
}
`;

export interface HtmlReportInput {
  runResult: RunResult;
  regressions: readonly Regression[];
  registry?: CoverageRegistry | undefined;
  coverageText?: string | undefined;
}

/** Render and write the self-contained HTML report. Returns its path. */
export function writeHtmlReport(input: HtmlReportInput, path: string): string {
  const { runResult } = input;
  const stats: [string, number, string][] = [
    ["Total", runResult.total_tests, "total"],
    ["Passed", runResult.passed, "pass"],
    ["Failed", runResult.failed, "fail"],
    ["Skipped", runResult.skipped, "skip"],
    ["Errors", runResult.errors, "error"],
  ];

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>QA run ${escapeHtml(runResult.run_id)}</title>
<style>${STYLES}</style>
</head>
<body>
<h1>QA run report</h1>
<div class="meta">
  <strong>${escapeHtml(runResult.target_url)}</strong><br>
  run <code>${escapeHtml(runResult.run_id)}</code> from plan <code>${escapeHtml(runResult.plan_id)}</code><br>
  ${escapeHtml(runResult.started_at)} &rarr; ${escapeHtml(runResult.completed_at)}
  (${runResult.duration_seconds.toFixed(1)}s)
</div>

<div class="summary-grid">
  ${stats
    .map(
      ([label, value, cls]) =>
        `<div class="stat ${cls}"><div class="n">${String(value)}</div><div class="muted">${label}</div></div>`,
    )
    .join("")}
</div>

${runResult.ai_summary === "" ? "" : `<div class="ai-summary">${escapeHtml(runResult.ai_summary)}</div>`}

${renderRegressions(input.regressions)}

${
  input.coverageText === undefined || input.coverageText === ""
    ? ""
    : `<section><h2>Coverage</h2><pre class="coverage">${escapeHtml(input.coverageText)}</pre></section>`
}

<section>
  <h2>Tests (${String(runResult.test_results.length)})</h2>
  ${runResult.test_results.map(renderTestCard).join("")}
</section>
</body>
</html>
`;

  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, html);
  return path;
}
