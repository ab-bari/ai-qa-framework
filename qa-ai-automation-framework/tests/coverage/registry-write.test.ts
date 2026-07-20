import { describe, expect, it } from "vitest";

import { emptyRegistry, updateRegistryFromRun } from "../../src/coverage/registry.js";
import { RunResultSchema, type RunResult } from "../../src/schemas/run-result.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";

const TARGET = "https://www.saucedemo.com";

function run(overrides: Record<string, unknown> = {}): RunResult {
  return RunResultSchema.parse({
    run_id: "run-1",
    plan_id: "plan-1",
    started_at: "2026-07-20T10:00:00.000Z",
    completed_at: "2026-07-20T10:01:00.000Z",
    target_url: TARGET,
    ...overrides,
  });
}

function testResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    test_id: "TC-001",
    test_name: "login works",
    category: "functional",
    result: "pass",
    coverage_signature: "functional:inventory:login-works",
    target_page_id: "loginpage",
    actual_page_id: "inventory",
    actual_url: `${TARGET}/inventory.html`,
    ...overrides,
  };
}

const siteModel = SiteModelSchema.parse({
  base_url: TARGET,
  pages: [
    { page_id: "inventory", url: `${TARGET}/inventory.html`, page_type: "listing" },
    { page_id: "loginpage", url: `${TARGET}/`, page_type: "form" },
  ],
});

describe("updateRegistryFromRun", () => {
  it("attributes coverage to actual_page_id, not the plan's target page", () => {
    const updated = updateRegistryFromRun(
      emptyRegistry(TARGET),
      run({ test_results: [testResult()] }),
      { siteModel },
    );
    expect(Object.keys(updated.pages)).toEqual(["inventory"]);
    expect(updated.pages.inventory?.page_type).toBe("listing");
    expect(updated.pages.inventory?.test_count).toBe(1);
  });

  it("falls back to target_page_id, then test_id, when there is no actual page", () => {
    const updated = updateRegistryFromRun(
      emptyRegistry(TARGET),
      run({
        test_results: [
          testResult({ test_id: "TC-A", actual_page_id: "" }),
          testResult({ test_id: "TC-B", actual_page_id: "", target_page_id: "" }),
        ],
      }),
    );
    expect(Object.keys(updated.pages).sort()).toEqual(["TC-B", "loginpage"]);
  });

  it("records the url from the test result for pages missing from the site model", () => {
    const updated = updateRegistryFromRun(
      emptyRegistry(TARGET),
      run({ test_results: [testResult({ actual_page_id: "unknown-page" })] }),
      { siteModel },
    );
    expect(updated.pages["unknown-page"]?.url).toBe(`${TARGET}/inventory.html`);
  });

  it("appends history to an existing signature instead of duplicating it", () => {
    const first = updateRegistryFromRun(emptyRegistry(TARGET), run({ test_results: [testResult()] }));
    const second = updateRegistryFromRun(
      first,
      run({ run_id: "run-2", test_results: [testResult({ result: "fail" })] }),
    );
    const signatures = second.pages.inventory?.categories.functional?.signatures_tested ?? [];
    expect(signatures).toHaveLength(1);
    expect(signatures[0]?.test_count).toBe(2);
    expect(signatures[0]?.last_result).toBe("fail");
    expect(signatures[0]?.history).toHaveLength(2);
  });

  it("trims signature history to the retention limit", () => {
    let registry = emptyRegistry(TARGET);
    for (let index = 0; index < 5; index++) {
      registry = updateRegistryFromRun(
        registry,
        run({ run_id: `run-${String(index)}`, test_results: [testResult()] }),
        { historyRetention: 3 },
      );
    }
    const signature = registry.pages.inventory?.categories.functional?.signatures_tested[0];
    expect(signature?.history).toHaveLength(3);
    expect(signature?.test_count).toBe(5);
  });

  it("counts a pass -> fail transition as a regression", () => {
    const first = updateRegistryFromRun(emptyRegistry(TARGET), run({ test_results: [testResult()] }));
    expect(first.global_stats.regression_count).toBe(0);
    const second = updateRegistryFromRun(
      first,
      run({ run_id: "run-2", test_results: [testResult({ result: "fail" })] }),
    );
    expect(second.global_stats.regression_count).toBe(1);
  });

  it("scores a category by the share of its signatures currently passing", () => {
    const updated = updateRegistryFromRun(
      emptyRegistry(TARGET),
      run({
        test_results: [
          testResult({ test_id: "TC-1", coverage_signature: "functional:inventory:a" }),
          testResult({
            test_id: "TC-2",
            coverage_signature: "functional:inventory:b",
            result: "fail",
          }),
        ],
      }),
    );
    expect(updated.pages.inventory?.categories.functional?.coverage_score).toBe(0.5);
    expect(updated.global_stats.category_scores.functional).toBe(0.5);
    expect(updated.global_stats.pages_tested).toBe(1);
  });

  it("does not mutate the registry it was given", () => {
    const original = emptyRegistry(TARGET);
    updateRegistryFromRun(original, run({ test_results: [testResult()] }));
    expect(Object.keys(original.pages)).toEqual([]);
  });

  it("falls back to the test name when a signature is missing", () => {
    const updated = updateRegistryFromRun(
      emptyRegistry(TARGET),
      run({ test_results: [testResult({ coverage_signature: "" })] }),
    );
    const signatures = updated.pages.inventory?.categories.functional?.signatures_tested ?? [];
    expect(signatures[0]?.signature).toBe("login works");
  });
});
