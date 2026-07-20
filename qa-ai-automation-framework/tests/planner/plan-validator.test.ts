import { describe, expect, it } from "vitest";

import {
  deriveCoverageSignature,
  RawPlanResponseSchema,
  slugify,
  validateTestCases,
} from "../../src/planner/plan-validator.js";
import { FrameworkConfigSchema, type FrameworkConfig } from "../../src/schemas/config.js";
import { TestCaseSchema } from "../../src/schemas/test-plan.js";

function config(overrides: Partial<FrameworkConfig> = {}): FrameworkConfig {
  return FrameworkConfigSchema.parse({
    target_url: "https://example.com",
    categories: ["functional", "security"],
    ...overrides,
  });
}

function rawCase(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    test_id: "tc_001",
    name: "Valid login",
    category: "functional",
    target_page_id: "p1",
    steps: [{ action_type: "navigate", value: "https://example.com/" }],
    ...overrides,
  };
}

describe("slugify", () => {
  it("kebab-cases and trims", () => {
    expect(slugify("Valid Login Redirects!")).toBe("valid-login-redirects");
    expect(slugify("   ")).toBe("unnamed");
  });
});

describe("deriveCoverageSignature", () => {
  it("joins category, page, and slug", () => {
    const tc = TestCaseSchema.parse(rawCase());
    expect(deriveCoverageSignature(tc)).toBe("functional:p1:valid-login");
  });
});

describe("validateTestCases", () => {
  it("keeps valid cases and derives missing signatures", () => {
    const { testCases, dropped } = validateTestCases([rawCase()], config());
    expect(dropped).toEqual([]);
    expect(testCases).toHaveLength(1);
    expect(testCases[0]?.coverage_signature).toBe("functional:p1:valid-login");
  });

  it("preserves an explicit coverage signature", () => {
    const { testCases } = validateTestCases(
      [rawCase({ coverage_signature: "functional:p1:custom" })],
      config(),
    );
    expect(testCases[0]?.coverage_signature).toBe("functional:p1:custom");
  });

  it("drops a case whose category is not enabled", () => {
    const { testCases, dropped } = validateTestCases(
      [rawCase({ test_id: "tc_v", category: "visual" })],
      config({ categories: ["functional"] }),
    );
    expect(testCases).toHaveLength(0);
    expect(dropped[0]?.reason).toMatch(/not enabled/);
  });

  it("drops a case with no steps", () => {
    const { dropped } = validateTestCases([rawCase({ steps: [] })], config());
    expect(dropped[0]?.reason).toMatch(/no steps/);
  });

  it("drops a click step missing a selector", () => {
    const { dropped } = validateTestCases(
      [rawCase({ steps: [{ action_type: "click", value: null }] })],
      config(),
    );
    expect(dropped[0]?.reason).toMatch(/requires a selector/);
  });

  it("drops a fill step missing a value", () => {
    const { dropped } = validateTestCases(
      [rawCase({ steps: [{ action_type: "fill", selector: "#u" }] })],
      config(),
    );
    expect(dropped[0]?.reason).toMatch(/fill requires a value/);
  });

  it("drops duplicate test_ids after the first", () => {
    const { testCases, dropped } = validateTestCases([rawCase(), rawCase()], config());
    expect(testCases).toHaveLength(1);
    expect(dropped[0]?.reason).toBe("duplicate test_id");
  });

  it("drops a structurally invalid case without a name", () => {
    const { dropped } = validateTestCases([rawCase({ name: undefined })], config());
    expect(dropped).toHaveLength(1);
    expect(dropped[0]?.test_id).toBe("tc_001");
  });
});

describe("RawPlanResponseSchema", () => {
  it("tolerates opaque test cases and defaults an empty array", () => {
    expect(RawPlanResponseSchema.parse({}).test_cases).toEqual([]);
    const parsed = RawPlanResponseSchema.parse({ test_cases: [{ anything: true }] });
    expect(parsed.test_cases).toHaveLength(1);
  });
});
