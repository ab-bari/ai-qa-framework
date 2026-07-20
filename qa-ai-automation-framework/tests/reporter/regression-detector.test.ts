import { describe, expect, it } from "vitest";

import { detectRegressions } from "../../src/reporter/regression-detector.js";
import { RunResultSchema, type RunResult } from "../../src/schemas/run-result.js";

function run(results: Record<string, unknown>[], runId = "run-1"): RunResult {
  return RunResultSchema.parse({
    run_id: runId,
    plan_id: "plan-1",
    started_at: "2026-07-20T10:00:00.000Z",
    completed_at: "2026-07-20T10:01:00.000Z",
    target_url: "https://www.saucedemo.com",
    test_results: results.map((result) => ({
      test_id: "TC-001",
      test_name: "login works",
      category: "functional",
      result: "pass",
      ...result,
    })),
  });
}

describe("detectRegressions", () => {
  it("reports a test that went pass -> fail", () => {
    const regressions = detectRegressions(
      run([{ coverage_signature: "functional:a:login" }]),
      run([{ coverage_signature: "functional:a:login", result: "fail", failure_reason: "boom" }]),
    );
    expect(regressions).toHaveLength(1);
    expect(regressions[0]?.previous_result).toBe("pass");
    expect(regressions[0]?.current_result).toBe("fail");
    expect(regressions[0]?.failure_reason).toBe("boom");
  });

  it("treats an error as a regression too", () => {
    const regressions = detectRegressions(run([{}]), run([{ result: "error" }]));
    expect(regressions).toHaveLength(1);
  });

  it("matches by coverage_signature even when the test was renamed", () => {
    const regressions = detectRegressions(
      run([{ test_name: "old name", coverage_signature: "functional:a:login" }]),
      run([{ test_name: "new name", coverage_signature: "functional:a:login", result: "fail" }]),
    );
    expect(regressions).toHaveLength(1);
  });

  it("falls back to the test name when there is no signature", () => {
    const regressions = detectRegressions(run([{}]), run([{ result: "fail" }]));
    expect(regressions).toHaveLength(1);
  });

  it("ignores tests that were already failing", () => {
    expect(detectRegressions(run([{ result: "fail" }]), run([{ result: "fail" }]))).toEqual([]);
  });

  it("ignores newly added tests with no prior run", () => {
    expect(detectRegressions(run([]), run([{ result: "fail" }]))).toEqual([]);
  });

  it("does not treat pass -> skip as a regression", () => {
    expect(detectRegressions(run([{}]), run([{ result: "skip" }]))).toEqual([]);
  });
});
