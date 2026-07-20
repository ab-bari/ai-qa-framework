import { describe, expect, it } from "vitest";

import { analyzeGaps } from "../../src/coverage/gap-analyzer.js";
import { CoverageRegistrySchema } from "../../src/schemas/coverage.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";

function siteModel() {
  return SiteModelSchema.parse({
    base_url: "https://example.com",
    pages: [
      { page_id: "p1", url: "https://example.com/" },
      { page_id: "p2", url: "https://example.com/inventory" },
    ],
  });
}

const HOUR = 60 * 60 * 1000;

describe("analyzeGaps", () => {
  it("marks every page untested against an empty registry", () => {
    const registry = CoverageRegistrySchema.parse({ target_url: "https://example.com" });
    const report = analyzeGaps(registry, siteModel());

    expect(report.untested_pages).toEqual(["p1", "p2"]);
    expect(report.stale_pages).toEqual([]);
    expect(report.suggested_focus).toContain("Test 2 untested pages");
  });

  it("flags stale pages by last_tested age", () => {
    const stale = new Date(Date.now() - 30 * 24 * HOUR).toISOString();
    const fresh = new Date(Date.now() - 1 * HOUR).toISOString();
    const registry = CoverageRegistrySchema.parse({
      target_url: "https://example.com",
      pages: {
        p1: { page_id: "p1", url: "https://example.com/", last_tested: stale },
        p2: { page_id: "p2", url: "https://example.com/inventory", last_tested: fresh },
      },
    });

    const report = analyzeGaps(registry, siteModel(), { stalenessDays: 7 });

    expect(report.untested_pages).toEqual([]);
    expect(report.stale_pages).toEqual(["p1"]);
  });

  it("surfaces low-coverage areas and recent failures", () => {
    const fresh = new Date(Date.now() - 1 * HOUR).toISOString();
    const registry = CoverageRegistrySchema.parse({
      target_url: "https://example.com",
      pages: {
        p1: {
          page_id: "p1",
          url: "https://example.com/",
          last_tested: fresh,
          categories: {
            functional: {
              category: "functional",
              coverage_score: 0.2,
              signatures_tested: [
                { signature: "functional:p1:login", last_result: "fail" },
                { signature: "functional:p1:logout", last_result: "pass" },
              ],
            },
          },
        },
        p2: { page_id: "p2", url: "https://example.com/inventory", last_tested: fresh },
      },
    });

    const report = analyzeGaps(registry, siteModel());

    expect(report.low_coverage_areas).toEqual([["p1", "functional", 0.2]]);
    expect(report.recent_failures).toEqual([["p1", "functional:p1:login"]]);
    expect(report.suggested_focus).toContain("Re-test 1 recent failures");
  });
});
