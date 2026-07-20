/**
 * Async semaphore for bounded concurrency (plan §8: "semaphore for
 * concurrency"). Used by the executor to cap `max_parallel_contexts`.
 * No module-level state — callers construct and own an instance.
 */

export class Semaphore {
  private available: number;
  private readonly waiters: (() => void)[] = [];

  constructor(permits: number) {
    this.available = Math.max(1, Math.floor(permits));
  }

  /** Run `fn` while holding a permit, releasing it even when `fn` throws. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /** Acquire a permit; the returned function releases it (idempotent). */
  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
    } else {
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      const next = this.waiters.shift();
      if (next === undefined) {
        this.available++;
      } else {
        next();
      }
    };
  }
}
