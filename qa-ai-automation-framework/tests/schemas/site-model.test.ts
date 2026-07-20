import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PageModelSchema, SiteModelSchema } from "../../src/schemas/site-model.js";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/site-model.json", import.meta.url), "utf8"),
);

describe("SiteModelSchema", () => {
  it("parses the fixture and survives a JSON round-trip", () => {
    const parsed = SiteModelSchema.parse(fixture);
    expect(parsed.base_url).toBe("https://www.saucedemo.com");
    expect(parsed.pages).toHaveLength(2);
    expect(parsed.pages[0]?.forms[0]?.fields).toHaveLength(2);
    expect(parsed.auth_flow?.detected_selectors.submit).toBe('[data-test="login-button"]');

    const reparsed = SiteModelSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("applies Python-model defaults for omitted fields", () => {
    const minimal = SiteModelSchema.parse({ base_url: "https://example.com" });
    expect(minimal.pages).toEqual([]);
    expect(minimal.navigation_graph).toEqual({});
    expect(minimal.api_endpoints).toEqual([]);
    expect(minimal.auth_flow).toBeNull();
    expect(minimal.crawl_metadata).toEqual({});
  });

  it("defaults PageModel.auth_required to null (unknown)", () => {
    const page = PageModelSchema.parse({ page_id: "abc", url: "https://example.com/x" });
    expect(page.auth_required).toBeNull();
    expect(page.page_type).toBe("static");
    expect(page.elements).toEqual([]);
  });

  it("rejects a site model without base_url", () => {
    expect(SiteModelSchema.safeParse({ pages: [] }).success).toBe(false);
  });

  it("rejects elements with non-string attribute values", () => {
    const result = PageModelSchema.safeParse({
      page_id: "abc",
      url: "https://example.com",
      elements: [
        {
          element_id: "e1",
          tag: "a",
          selector: "a.nav",
          attributes: { tabindex: 3 },
        },
      ],
    });
    expect(result.success).toBe(false);
  });
});
