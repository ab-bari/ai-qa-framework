import { describe, expect, it } from "vitest";

import {
  elementId,
  md5Hex,
  newPlanId,
  newRunId,
  normalizeUrl,
  pageIdFromUrl,
  timestampId,
} from "../../src/core/ids.js";

describe("ids", () => {
  it("md5Hex matches a known vector", () => {
    // Same digest Python's hashlib.md5(b"hello").hexdigest() produces.
    expect(md5Hex("hello")).toBe("5d41402abc4b2a76b9719d911017c592");
  });

  it("normalizeUrl strips trailing slashes, drops fragments, sorts query params", () => {
    expect(normalizeUrl("https://example.com/shop/")).toBe("https://example.com/shop");
    expect(normalizeUrl("https://example.com/")).toBe("https://example.com/");
    expect(normalizeUrl("https://example.com/a#section")).toBe("https://example.com/a");
    expect(normalizeUrl("https://example.com/a?b=2&a=1")).toBe("https://example.com/a?a=1&b=2");
    expect(normalizeUrl("https://example.com:8080/x")).toBe("https://example.com:8080/x");
  });

  it("pageIdFromUrl is stable across equivalent URLs and 12 chars long", () => {
    const id = pageIdFromUrl("https://example.com/shop/?b=2&a=1");
    expect(id).toHaveLength(12);
    expect(id).toBe(pageIdFromUrl("https://example.com/shop?a=1&b=2#top"));
    expect(id).not.toBe(pageIdFromUrl("https://example.com/shop/item"));
  });

  it("elementId is 10 chars and varies with each input", () => {
    const base = elementId("page1", "[data-test='login']", "button");
    expect(base).toHaveLength(10);
    expect(base).not.toBe(elementId("page2", "[data-test='login']", "button"));
    expect(base).not.toBe(elementId("page1", "[data-test='login']", "a"));
  });

  it("timestamp ids are filesystem-safe and prefixed", () => {
    const date = new Date(2026, 6, 20, 15, 30, 12);
    expect(timestampId(date)).toBe("20260720-153012");
    expect(newPlanId(date)).toBe("plan-20260720-153012");
    expect(newRunId(date)).toBe("run-20260720-153012");
  });
});
