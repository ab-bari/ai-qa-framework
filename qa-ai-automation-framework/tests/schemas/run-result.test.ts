import { describe, expect, it } from "vitest";

import {
  FallbackRecordSchema,
  RunResultSchema,
  TestResultSchema,
} from "../../src/schemas/run-result.js";

describe("RunResultSchema", () => {
  it("parses a full run result and survives a JSON round-trip", () => {
    const runResult = {
      run_id: "run-20260720-130000",
      plan_id: "plan-20260720-120000",
      started_at: "2026-07-20T13:00:00.000Z",
      completed_at: "2026-07-20T13:04:12.000Z",
      target_url: "https://www.saucedemo.com",
      total_tests: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      errors: 0,
      duration_seconds: 252.4,
      ai_summary: "One login regression on the inventory page.",
      test_results: [
        {
          test_id: "TC-001",
          test_name: "Login with valid credentials",
          category: "functional",
          priority: 1,
          target_page_id: "a1b2c3d4e5f6",
          actual_page_id: "b2c3d4e5f6a1",
          actual_url: "https://www.saucedemo.com/inventory.html",
          coverage_signature: "functional:a1b2c3d4e5f6:login",
          result: "pass",
          duration_seconds: 8.2,
          evidence: {
            screenshots: ["runs/run-20260720-130000/evidence/TC-001/step-1.png"],
            console_logs: [],
            network_log: [{ url: "https://www.saucedemo.com/", status: 200 }],
            dom_snapshot_path: null,
            video_path: null,
          },
          fallback_records: [
            {
              step_index: 2,
              original_selector: "#login_button",
              decision: "adapt",
              new_selector: '[data-test="login-button"]',
              reasoning: "Original id not present; data-test attribute matches.",
            },
          ],
          step_results: [
            {
              step_index: 0,
              action_type: "fill",
              selector: '[data-test="username"]',
              status: "pass",
            },
          ],
          assertion_results: [
            {
              assertion_type: "url_matches",
              expected_value: ".*inventory.html",
              passed: true,
              actual_value: "https://www.saucedemo.com/inventory.html",
            },
          ],
          assertions_passed: 1,
          assertions_failed: 0,
          assertions_total: 1,
        },
        {
          test_id: "TC-002",
          test_name: "Locked out user sees error",
          category: "security",
          result: "fail",
          failure_reason: "Expected error banner not visible",
        },
      ],
    };
    const parsed = RunResultSchema.parse(runResult);
    expect(parsed.test_results).toHaveLength(2);
    expect(parsed.test_results[0]?.fallback_records[0]?.decision).toBe("adapt");
    const reparsed = RunResultSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("keeps the v1 schema hooks with their inert defaults", () => {
    const result = TestResultSchema.parse({
      test_id: "TC-003",
      test_name: "minimal",
      category: "functional",
      result: "skip",
    });
    expect(result.potentially_flaky).toBe(false);
    expect(result.evidence.video_path).toBeNull();
  });

  it("rejects invalid outcome and fallback decision values", () => {
    expect(
      TestResultSchema.safeParse({
        test_id: "x",
        test_name: "y",
        category: "functional",
        result: "flaky",
      }).success,
    ).toBe(false);
    expect(FallbackRecordSchema.safeParse({ step_index: 0, decision: "improvise" }).success).toBe(
      false,
    );
  });
});
