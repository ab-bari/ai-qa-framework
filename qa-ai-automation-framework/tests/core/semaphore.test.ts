import { describe, expect, it } from "vitest";

import { Semaphore } from "../../src/core/semaphore.js";

/** Let queued microtasks run — `run()` is async, so nothing starts synchronously. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("Semaphore", () => {
  it("never exceeds the permit count", async () => {
    const semaphore = new Semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 8 }, () =>
        semaphore.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
    expect(active).toBe(0);
  });

  it("releases the permit when the task throws", async () => {
    const semaphore = new Semaphore(1);
    await expect(
      semaphore.run(() => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    await expect(semaphore.run(() => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("hands a freed permit to the longest-waiting caller", async () => {
    const semaphore = new Semaphore(1);
    const order: number[] = [];
    const gate = deferred();

    const first = semaphore.run(async () => {
      order.push(1);
      await gate.promise;
    });
    const second = semaphore.run(() => {
      order.push(2);
      return Promise.resolve();
    });
    const third = semaphore.run(() => {
      order.push(3);
      return Promise.resolve();
    });

    await tick();
    expect(order).toEqual([1]);
    gate.resolve();
    await Promise.all([first, second, third]);
    expect(order).toEqual([1, 2, 3]);
  });

  it("treats a release as idempotent", async () => {
    const semaphore = new Semaphore(1);
    const release = await semaphore.acquire();
    release();
    release();
    // A double release must not have created a second permit.
    const gate = deferred();
    let secondStarted = false;
    const held = semaphore.run(() => gate.promise);
    const queued = semaphore.run(() => {
      secondStarted = true;
      return Promise.resolve();
    });
    await tick();
    expect(secondStarted).toBe(false);
    gate.resolve();
    await Promise.all([held, queued]);
  });

  it("clamps a non-positive permit count to one", async () => {
    const semaphore = new Semaphore(0);
    await expect(semaphore.run(() => Promise.resolve("ran"))).resolves.toBe("ran");
  });
});
