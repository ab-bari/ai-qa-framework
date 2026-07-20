import { describe, expect, it } from "vitest";

import {
  ActionSchema,
  ActionTypeSchema,
  AssertionSchema,
  AssertionTypeSchema,
  TestCaseSchema,
  TestPlanSchema,
} from "../../src/schemas/test-plan.js";

describe("TestPlanSchema", () => {
  it("covers exactly the 9 action types and 14 assertion types from the plan", () => {
    expect(ActionTypeSchema.options).toHaveLength(9);
    expect(AssertionTypeSchema.options).toHaveLength(14);
    expect(AssertionTypeSchema.options).toContain("ai_evaluate");
    // Reserved v1 schema hook (plan §10) — kept in the enum, stubbed at execution.
    expect(AssertionTypeSchema.options).toContain("screenshot_diff");
  });

  it("parses a full plan and survives a JSON round-trip", () => {
    const plan = {
      plan_id: "plan-20260720-120000",
      generated_at: "2026-07-20T12:00:00.000Z",
      target_url: "https://www.saucedemo.com",
      test_cases: [
        {
          test_id: "TC-001",
          name: "Login with valid credentials",
          description: "Standard user can log in",
          category: "functional",
          priority: 1,
          target_page_id: "a1b2c3d4e5f6",
          coverage_signature: "functional:a1b2c3d4e5f6:login-with-valid-credentials",
          requires_auth: false,
          preconditions: [{ action_type: "navigate", value: "https://www.saucedemo.com/" }],
          steps: [
            {
              action_type: "fill",
              selector: '[data-test="username"]',
              value: "{{auth_username}}",
              description: "Fill username",
            },
            {
              action_type: "fill",
              selector: '[data-test="password"]',
              value: "{{auth_password}}",
              description: "Fill password",
            },
            { action_type: "click", selector: '[data-test="login-button"]' },
          ],
          assertions: [
            { assertion_type: "url_matches", expected_value: ".*inventory.html" },
            { assertion_type: "no_console_errors" },
          ],
          timeout_seconds: 45,
        },
      ],
      estimated_duration_seconds: 60,
      coverage_intent: { fallback: false },
    };
    const parsed = TestPlanSchema.parse(plan);
    expect(parsed.test_cases[0]?.steps).toHaveLength(3);
    const reparsed = TestPlanSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("applies TestCase defaults matching the Python model", () => {
    const testCase = TestCaseSchema.parse({ test_id: "TC-002", name: "minimal" });
    expect(testCase.category).toBe("functional");
    expect(testCase.priority).toBe(3);
    expect(testCase.requires_auth).toBe(true);
    expect(testCase.timeout_seconds).toBe(30);
    expect(testCase.steps).toEqual([]);
  });

  it("rejects unknown action and assertion types", () => {
    expect(ActionSchema.safeParse({ action_type: "drag" }).success).toBe(false);
    expect(AssertionSchema.safeParse({ assertion_type: "looks_nice" }).success).toBe(false);
  });

  it("rejects priorities outside 1-5", () => {
    expect(TestCaseSchema.safeParse({ test_id: "x", name: "y", priority: 0 }).success).toBe(false);
    expect(TestCaseSchema.safeParse({ test_id: "x", name: "y", priority: 6 }).success).toBe(false);
  });
});
