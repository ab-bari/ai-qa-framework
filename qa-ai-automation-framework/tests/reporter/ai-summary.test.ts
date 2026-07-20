import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { generateRunSummary, templateSummary } from "../../src/reporter/ai-summary.js";
import { RunResultSchema, type RunResult } from "../../src/schemas/run-result.js";

const logger = createLogger({ level: "error" });

function run(overrides: Partial<RunResult> = {}): RunResult {
  return RunResultSchema.parse({
    run_id: "run-1",
    plan_id: "plan-1",
    started_at: "2026-07-20T10:00:00.000Z",
    completed_at: "2026-07-20T10:01:00.000Z",
    target_url: "https://www.saucedemo.com",
    total_tests: 2,
    passed: 1,
    failed: 1,
    duration_seconds: 12.5,
    test_results: [
      { test_id: "TC-1", test_name: "login works", category: "functional", result: "pass" },
      { test_id: "TC-2", test_name: "cart totals", category: "functional", result: "fail" },
    ],
    ...overrides,
  });
}

describe("templateSummary", () => {
  it("states the counts and names the failures", () => {
    const summary = templateSummary(run());
    expect(summary).toContain("2 tests");
    expect(summary).toContain("1 passed, 1 failed");
    expect(summary).toContain("cart totals");
  });
});

describe("generateRunSummary", () => {
  it("uses the template when no provider is attached", async () => {
    expect(await generateRunSummary(run(), { logger })).toBe(templateSummary(run()));
  });

  it("returns the model's prose when the call succeeds", async () => {
    const llm = new FakeLlmProvider(["The cart total test regressed on the inventory page."]);
    const summary = await generateRunSummary(run(), { llm, logger });
    expect(summary).toBe("The cart total test regressed on the inventory page.");
  });

  it("sends a digest, not the whole RunResult with its evidence blobs", async () => {
    const llm = new FakeLlmProvider(["ok"]);
    await generateRunSummary(run(), { llm, logger, coverageText: "Overall score: 50%" });
    const prompt = llm.requests[0]?.prompt ?? "";
    expect(prompt).toContain("cart totals");
    expect(prompt).toContain("Overall score: 50%");
    expect(prompt).not.toContain("assertion_results");
  });

  it("falls back to the template when the model call fails", async () => {
    const llm = new FakeLlmProvider(() => new Error("provider unavailable"));
    expect(await generateRunSummary(run(), { llm, logger })).toBe(templateSummary(run()));
  });

  it("falls back to the template when the model returns nothing", async () => {
    const llm = new FakeLlmProvider(["   "]);
    expect(await generateRunSummary(run(), { llm, logger })).toBe(templateSummary(run()));
  });
});
