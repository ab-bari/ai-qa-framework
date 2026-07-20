import { describe, expect, it } from "vitest";

import { summarizeSiteModel } from "../../src/planner/site-summarizer.js";
import { CoverageGapReportSchema } from "../../src/schemas/coverage.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";

function pageWithElements(id: string, interactive: number, nonInteractive: number) {
  const elements = [];
  for (let i = 0; i < interactive; i++) {
    elements.push({
      element_id: `${id}-i${String(i)}`,
      tag: "button",
      selector: `#i${String(i)}`,
      element_type: "button",
      is_interactive: true,
    });
  }
  for (let i = 0; i < nonInteractive; i++) {
    elements.push({
      element_id: `${id}-n${String(i)}`,
      tag: "span",
      selector: `.n${String(i)}`,
      element_type: "text",
      is_interactive: false,
    });
  }
  return { page_id: id, url: `https://example.com/${id}`, page_type: "detail", elements };
}

const emptyGap = CoverageGapReportSchema.parse({});

describe("summarizeSiteModel", () => {
  it("condenses elements to interactive-only, capped at 20", () => {
    const site = SiteModelSchema.parse({
      base_url: "https://example.com",
      pages: [pageWithElements("p1", 25, 10)],
    });
    const summary = JSON.parse(summarizeSiteModel(site, emptyGap)) as {
      pages: { key_elements: unknown[]; interactive_elements_count: number }[];
    };
    expect(summary.pages[0]?.key_elements).toHaveLength(20);
    expect(summary.pages[0]?.interactive_elements_count).toBe(25);
  });

  it("limits to 30 pages, gap-flagged first", () => {
    const pages = [];
    for (let i = 0; i < 40; i++) {
      pages.push(pageWithElements(`p${String(i)}`, 1, 0));
    }
    const site = SiteModelSchema.parse({ base_url: "https://example.com", pages });
    const gap = CoverageGapReportSchema.parse({ untested_pages: ["p39"] });

    const summary = JSON.parse(summarizeSiteModel(site, gap)) as {
      pages: { page_id: string }[];
    };
    expect(summary.pages).toHaveLength(30);
    expect(summary.pages[0]?.page_id).toBe("p39");
  });

  it("includes auth flow and top API endpoints", () => {
    const site = SiteModelSchema.parse({
      base_url: "https://example.com",
      pages: [pageWithElements("p1", 1, 0)],
      auth_flow: { login_url: "https://example.com/login" },
      api_endpoints: [{ url: "https://example.com/api/x", method: "GET" }],
    });
    const summary = JSON.parse(summarizeSiteModel(site, emptyGap)) as {
      has_auth: boolean;
      auth_flow: { login_url: string } | null;
      top_api_endpoints: { url: string }[];
    };
    expect(summary.has_auth).toBe(true);
    expect(summary.auth_flow?.login_url).toBe("https://example.com/login");
    expect(summary.top_api_endpoints[0]?.url).toBe("https://example.com/api/x");
  });
});
