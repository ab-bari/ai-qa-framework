/**
 * Priority-queue crawl frontier (plan §6.1). A binary min-heap keyed by
 * `(priority, seq)` so links discovered by actually visiting pages (ORGANIC)
 * are crawled before sitemap-only backfill (SITEMAP), with FIFO ordering within
 * a priority level. Ported from the Python `_CrawlEntry` / `_enqueue` logic.
 *
 * The frontier owns visited/queued dedup (keyed on the normalized URL); scope
 * filtering (same-origin + include/exclude patterns) stays in the crawler.
 */

/** Lower number = higher priority (popped first). */
export const CrawlPriority = {
  START: 0,
  ORGANIC: 10,
  INTERACTIVE: 20,
  SITEMAP: 50,
} as const;

export interface CrawlEntry {
  url: string;
  depth: number;
  priority: number;
  /** Insertion order — tie-breaker for equal priorities (FIFO). */
  seq: number;
}

/** entry `a` should be popped before `b`? */
function precedes(a: CrawlEntry, b: CrawlEntry): boolean {
  if (a.priority !== b.priority) {
    return a.priority < b.priority;
  }
  return a.seq < b.seq;
}

export class Frontier {
  private readonly heap: CrawlEntry[] = [];
  private readonly queued = new Set<string>();
  private readonly visited = new Set<string>();
  private seq = 0;

  constructor(private readonly normalize: (url: string) => string) {}

  private key(url: string): string | null {
    try {
      return this.normalize(url);
    } catch {
      return null;
    }
  }

  /** Queue a URL if it has not already been visited or queued. Returns true when newly queued. */
  enqueue(url: string, depth: number, priority: number): boolean {
    const normalized = this.key(url);
    if (normalized === null) {
      return false;
    }
    if (this.visited.has(normalized) || this.queued.has(normalized)) {
      return false;
    }
    this.queued.add(normalized);
    this.push({ url, depth, priority, seq: this.seq++ });
    return true;
  }

  /** Pop the highest-priority entry, or undefined when empty. */
  pop(): CrawlEntry | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    const top = this.heap[0];
    const last = this.heap.pop();
    if (last !== undefined && this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  markVisited(url: string): void {
    const normalized = this.key(url);
    if (normalized !== null) {
      this.visited.add(normalized);
    }
  }

  isVisited(url: string): boolean {
    const normalized = this.key(url);
    return normalized !== null && this.visited.has(normalized);
  }

  get visitedCount(): number {
    return this.visited.size;
  }

  get seenCount(): number {
    return this.queued.size;
  }

  get size(): number {
    return this.heap.length;
  }

  private push(entry: CrawlEntry): void {
    this.heap.push(entry);
    this.siftUp(this.heap.length - 1);
  }

  private siftUp(index: number): void {
    let i = index;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      const node = this.heap[i];
      const parentNode = this.heap[parent];
      if (node === undefined || parentNode === undefined || !precedes(node, parentNode)) {
        break;
      }
      this.heap[i] = parentNode;
      this.heap[parent] = node;
      i = parent;
    }
  }

  private siftDown(index: number): void {
    const length = this.heap.length;
    let i = index;
    for (;;) {
      const left = i * 2 + 1;
      const right = i * 2 + 2;
      let smallest = i;
      const smallestNode = this.heap[smallest];
      const leftNode = this.heap[left];
      const rightNode = this.heap[right];
      if (
        left < length &&
        leftNode !== undefined &&
        smallestNode !== undefined &&
        precedes(leftNode, smallestNode)
      ) {
        smallest = left;
      }
      const currentSmallest = this.heap[smallest];
      if (
        right < length &&
        rightNode !== undefined &&
        currentSmallest !== undefined &&
        precedes(rightNode, currentSmallest)
      ) {
        smallest = right;
      }
      if (smallest === i) {
        break;
      }
      const node = this.heap[i];
      const swap = this.heap[smallest];
      if (node === undefined || swap === undefined) {
        break;
      }
      this.heap[i] = swap;
      this.heap[smallest] = node;
      i = smallest;
    }
  }
}
