import { describe, expect, it } from "vitest";

import { isValidPageUrl, resolveUrls } from "../../src/crawler/link-discovery.js";

describe("isValidPageUrl", () => {
  it("accepts http(s) page URLs", () => {
    expect(isValidPageUrl("https://x.com/inventory.html")).toBe(true);
    expect(isValidPageUrl("http://x.com/cart")).toBe(true);
    expect(isValidPageUrl("https://x.com/")).toBe(true);
  });

  it("rejects asset and feed extensions", () => {
    for (const url of [
      "https://x.com/logo.png",
      "https://x.com/app.js",
      "https://x.com/styles.css",
      "https://x.com/doc.pdf",
      "https://x.com/data.json",
      "https://x.com/feed.xml",
    ]) {
      expect(isValidPageUrl(url)).toBe(false);
    }
  });

  it("rejects non-http(s) schemes and garbage", () => {
    expect(isValidPageUrl("mailto:a@b.com")).toBe(false);
    expect(isValidPageUrl("ftp://x.com/file")).toBe(false);
    expect(isValidPageUrl("not a url")).toBe(false);
  });
});

describe("resolveUrls", () => {
  const base = "https://x.com/products/list";

  it("resolves relative hrefs against the base and drops fragments", () => {
    const out = resolveUrls(["/cart", "detail?id=1", "#section"], base);
    expect(out.has("https://x.com/cart")).toBe(true);
    expect(out.has("https://x.com/products/detail?id=1")).toBe(true);
    // The fragment-only href resolves to the base path (fragment stripped).
    expect(out.has("https://x.com/products/list")).toBe(true);
  });

  it("dedupes and filters out asset URLs", () => {
    const out = resolveUrls(
      ["https://x.com/a", "https://x.com/a", "https://x.com/icon.svg"],
      base,
    );
    expect(out.has("https://x.com/a")).toBe(true);
    expect(out.has("https://x.com/icon.svg")).toBe(false);
    expect(out.size).toBe(1);
  });

  it("keeps the query string but not the fragment", () => {
    const out = resolveUrls(["https://x.com/p?q=1#frag"], base);
    expect([...out]).toEqual(["https://x.com/p?q=1"]);
  });
});
