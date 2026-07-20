import { describe, expect, it } from "vitest";

import { normalizeUrl } from "../../src/core/ids.js";
import { CrawlPriority, Frontier } from "../../src/crawler/frontier.js";

describe("Frontier", () => {
  it("pops higher-priority (lower number) entries first", () => {
    const f = new Frontier(normalizeUrl);
    f.enqueue("https://x.com/sitemap-only", 1, CrawlPriority.SITEMAP);
    f.enqueue("https://x.com/organic", 1, CrawlPriority.ORGANIC);
    f.enqueue("https://x.com/start", 0, CrawlPriority.START);

    expect(f.pop()?.url).toBe("https://x.com/start");
    expect(f.pop()?.url).toBe("https://x.com/organic");
    expect(f.pop()?.url).toBe("https://x.com/sitemap-only");
    expect(f.pop()).toBeUndefined();
  });

  it("preserves FIFO order within the same priority level", () => {
    const f = new Frontier(normalizeUrl);
    f.enqueue("https://x.com/a", 1, CrawlPriority.ORGANIC);
    f.enqueue("https://x.com/b", 1, CrawlPriority.ORGANIC);
    f.enqueue("https://x.com/c", 1, CrawlPriority.ORGANIC);

    expect(f.pop()?.url).toBe("https://x.com/a");
    expect(f.pop()?.url).toBe("https://x.com/b");
    expect(f.pop()?.url).toBe("https://x.com/c");
  });

  it("dedupes on the normalized URL and reports newly-queued", () => {
    const f = new Frontier(normalizeUrl);
    expect(f.enqueue("https://x.com/p", 0, CrawlPriority.START)).toBe(true);
    // Same URL with a trailing slash + fragment normalizes to the same key.
    expect(f.enqueue("https://x.com/p/#frag", 0, CrawlPriority.START)).toBe(false);
    expect(f.seenCount).toBe(1);
  });

  it("does not re-queue a visited URL", () => {
    const f = new Frontier(normalizeUrl);
    f.enqueue("https://x.com/p", 0, CrawlPriority.START);
    const entry = f.pop();
    if (entry === undefined) {
      throw new Error("expected an entry");
    }
    f.markVisited(entry.url);
    expect(f.isVisited("https://x.com/p")).toBe(true);
    expect(f.enqueue("https://x.com/p", 0, CrawlPriority.START)).toBe(false);
    expect(f.visitedCount).toBe(1);
  });

  it("rejects unparseable URLs without throwing", () => {
    const f = new Frontier(normalizeUrl);
    expect(f.enqueue("not a url", 0, CrawlPriority.START)).toBe(false);
    expect(f.size).toBe(0);
  });

  it("maintains heap order across many mixed-priority inserts", () => {
    const f = new Frontier(normalizeUrl);
    for (let i = 0; i < 20; i++) {
      f.enqueue(`https://x.com/o${String(i)}`, 1, CrawlPriority.ORGANIC);
      f.enqueue(`https://x.com/s${String(i)}`, 1, CrawlPriority.SITEMAP);
    }
    const priorities: number[] = [];
    let entry = f.pop();
    while (entry !== undefined) {
      priorities.push(entry.priority);
      entry = f.pop();
    }
    // All ORGANIC (10) must come out before any SITEMAP (50).
    expect(priorities).toEqual([...priorities].sort((a, b) => a - b));
    expect(priorities.filter((p) => p === CrawlPriority.ORGANIC)).toHaveLength(20);
  });
});
