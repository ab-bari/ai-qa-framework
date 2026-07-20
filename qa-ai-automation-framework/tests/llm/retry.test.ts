import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LlmError } from "../../src/core/errors.js";
import { AuthLlmError, TransientLlmError, withRetry } from "../../src/llm/retry.js";

beforeEach(() => {
  // Make backoff instant so the retry tests don't wait 2s/8s/30s.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("withRetry", () => {
  it("returns the first successful result without retrying", async () => {
    const attempt = vi.fn().mockResolvedValue("ok");
    const promise = withRetry(attempt, { purpose: "planner" });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("ok");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("retries transient errors up to 3 attempts then throws LlmError", async () => {
    const attempt = vi.fn().mockRejectedValue(new TransientLlmError("timeout", "boom"));
    const assertion = expect(withRetry(attempt, { purpose: "planner" })).rejects.toBeInstanceOf(
      LlmError,
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("recovers when a later attempt succeeds", async () => {
    const attempt = vi
      .fn()
      .mockRejectedValueOnce(new TransientLlmError("spawn-failure", "flaky"))
      .mockResolvedValue("recovered");
    const promise = withRetry(attempt, { purpose: "summary" });
    await vi.runAllTimersAsync();
    expect(await promise).toBe("recovered");
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it("never retries auth errors and remediates with `claude login`", async () => {
    const attempt = vi.fn().mockRejectedValue(new AuthLlmError("not logged in"));
    const captured = withRetry(attempt, { purpose: "planner" }).catch((e: unknown) => e);
    await vi.runAllTimersAsync();
    const error = await captured;
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("LLM_ERROR");
    expect((error as LlmError).remediation).toContain("claude login");
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it("does not retry non-transient, non-auth errors", async () => {
    const attempt = vi.fn().mockRejectedValue(new Error("programmer bug"));
    const assertion = expect(withRetry(attempt, { purpose: "planner" })).rejects.toThrow(
      "programmer bug",
    );
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(1);
  });
});
