import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeHtmlReport } from "../../src/reporter/html-report.js";
import { RunResultSchema, type RunResult } from "../../src/schemas/run-result.js";

function run(results: Record<string, unknown>[] = []): RunResult {
  return RunResultSchema.parse({
    run_id: "run-20260720-120000",
    plan_id: "plan-20260720-115900",
    started_at: "2026-07-20T12:00:00.000Z",
    completed_at: "2026-07-20T12:01:00.000Z",
    target_url: "https://www.saucedemo.com",
    total_tests: results.length,
    test_results: results.map((result) => ({
      test_id: "TC-001",
      test_name: "login works",
      category: "functional",
      result: "pass",
      ...result,
    })),
  });
}

describe("writeHtmlReport", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "qa-ai-html-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const render = (runResult: RunResult, regressions: Parameters<typeof writeHtmlReport>[0]["regressions"] = []): string => {
    const path = writeHtmlReport({ runResult, regressions }, join(dir, "report.html"));
    return readFileSync(path, "utf8");
  };

  it("produces a self-contained document with the run identity", () => {
    const html = render(run([{}]));
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("run-20260720-120000");
    expect(html).toContain("plan-20260720-115900");
    // No external assets — everything inline (plan §6.3 "self-contained").
    expect(html).not.toMatch(/<link[^>]+href=|<script[^>]+src=/);
  });

  it("escapes HTML in test data so a page title cannot break the report", () => {
    const html = render(run([{ test_name: "<img src=x onerror=alert(1)>" }]));
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("renders a failure banner and the failing assertion", () => {
    const html = render(
      run([
        {
          result: "fail",
          failure_reason: "expected title Swag Labs",
          assertion_results: [
            {
              assertion_type: "page_title_contains",
              expected_value: "Swag Labs",
              passed: false,
              message: "Title 'Nope' does not contain 'Swag Labs'",
            },
          ],
        },
      ]),
    );
    expect(html).toContain("failure-banner");
    expect(html).toContain("expected title Swag Labs");
    expect(html).toContain("does not contain");
  });

  it("shows skipped assertions as skipped rather than passed", () => {
    const html = render(
      run([
        {
          assertion_results: [
            {
              assertion_type: "screenshot_diff",
              passed: true,
              message: "SKIPPED — screenshot_diff is not implemented in v1",
            },
          ],
        },
      ]),
    );
    expect(html).toContain('class="row skip"');
  });

  it("renders AI fallback decisions so healing is visible", () => {
    const html = render(
      run([
        {
          fallback_records: [
            {
              step_index: 2,
              original_selector: "#gone",
              decision: "retry",
              new_selector: "[data-test='username']",
              reasoning: "the field moved",
            },
          ],
        },
      ]),
    );
    expect(html).toContain("AI fallback decisions");
    expect(html).toContain("the field moved");
  });

  it("renders a regressions table only when there are regressions", () => {
    expect(render(run([{}]))).not.toContain("Regressions (");
    const html = render(run([{ result: "fail" }]), [
      {
        test_id: "TC-001",
        test_name: "login works",
        category: "functional",
        coverage_signature: "functional:a:login",
        previous_result: "pass",
        current_result: "fail",
        failure_reason: "boom",
      },
    ]);
    expect(html).toContain("Regressions (1)");
    expect(html).toContain("login works");
  });

  it("notes screenshots it could not embed instead of emitting a broken image", () => {
    const html = render(
      run([{ evidence: { screenshots: [join(dir, "missing.png")] } }]),
    );
    expect(html).toContain("Not embedded");
    expect(html).not.toContain("<img src=\"data:");
  });
});
