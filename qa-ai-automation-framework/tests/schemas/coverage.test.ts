import { describe, expect, it } from "vitest";

import { CoverageGapReportSchema, CoverageRegistrySchema } from "../../src/schemas/coverage.js";

describe("CoverageRegistrySchema", () => {
  it("parses a populated registry and survives a JSON round-trip", () => {
    const registry = {
      target_url: "https://www.saucedemo.com",
      last_updated: "2026-07-20T13:05:00.000Z",
      pages: {
        a1b2c3d4e5f6: {
          page_id: "a1b2c3d4e5f6",
          url: "https://www.saucedemo.com/",
          page_type: "form",
          categories: {
            functional: {
              category: "functional",
              signatures_tested: [
                {
                  signature: "functional:a1b2c3d4e5f6:login",
                  last_tested: "2026-07-20T13:04:00.000Z",
                  last_result: "pass",
                  test_count: 3,
                  history: [
                    {
                      run_id: "run-20260720-130000",
                      timestamp: "2026-07-20T13:04:00.000Z",
                      result: "pass",
                      duration_seconds: 8.2,
                      failure_reason: null,
                    },
                  ],
                },
              ],
              coverage_score: 0.6,
              last_tested: "2026-07-20T13:04:00.000Z",
            },
          },
          elements_tested: {
            "0123456789": {
              element_id: "0123456789",
              tested: true,
              last_tested: "2026-07-20T13:04:00.000Z",
              test_count: 3,
            },
          },
          last_tested: "2026-07-20T13:04:00.000Z",
          test_count: 3,
        },
      },
      journeys: {},
      global_stats: {
        total_pages: 2,
        pages_tested: 1,
        overall_score: 0.3,
        category_scores: { functional: 0.6, security: 0 },
        last_full_run: "run-20260720-130000",
        regression_count: 0,
      },
    };
    const parsed = CoverageRegistrySchema.parse(registry);
    expect(parsed.pages.a1b2c3d4e5f6?.categories.functional?.coverage_score).toBe(0.6);
    const reparsed = CoverageRegistrySchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("builds an empty registry from just a target_url (fresh-start case)", () => {
    const empty = CoverageRegistrySchema.parse({ target_url: "https://example.com" });
    expect(empty.pages).toEqual({});
    expect(empty.global_stats.total_pages).toBe(0);
    expect(empty.global_stats.category_scores).toEqual({});
  });

  it("parses gap-report tuples ported from Python tuple fields", () => {
    const report = CoverageGapReportSchema.parse({
      untested_pages: ["b2c3d4e5f6a1"],
      stale_pages: [],
      low_coverage_areas: [["a1b2c3d4e5f6", "security", 0.1]],
      recent_failures: [["b2c3d4e5f6a1", "functional:b2c3d4e5f6a1:add-to-cart"]],
      suggested_focus: ["b2c3d4e5f6a1"],
    });
    expect(report.low_coverage_areas[0]).toEqual(["a1b2c3d4e5f6", "security", 0.1]);
    // Tuple arity is enforced.
    expect(
      CoverageGapReportSchema.safeParse({ low_coverage_areas: [["only-page-id"]] }).success,
    ).toBe(false);
  });
});
