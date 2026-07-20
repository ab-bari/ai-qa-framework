import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { AuthLlmError, TransientLlmError } from "../../src/llm/retry.js";

const Schema = z.object({ verdict: z.boolean(), confidence: z.number() });

describe("FakeLlmProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns canned text and records requests", async () => {
    const provider = new FakeLlmProvider(["hello there"]);
    const promise = provider.complete({ purpose: "echo", prompt: "hi" });
    await vi.runAllTimersAsync();
    const response = await promise;
    expect(response.text).toBe("hello there");
    expect(provider.requests[0]?.prompt).toBe("hi");
    expect(provider.calls).toBe(1);
  });

  it("drives the real json-mode pipeline (fenced parse)", async () => {
    const provider = new FakeLlmProvider(['```json\n{"verdict":true,"confidence":0.9}\n```']);
    const promise = provider.completeJson({ purpose: "ai-evaluate", prompt: "judge" }, Schema);
    await vi.runAllTimersAsync();
    expect(await promise).toEqual({ verdict: true, confidence: 0.9 });
  });

  it("exercises the retry path via a thrown TransientLlmError", async () => {
    let call = 0;
    const provider = new FakeLlmProvider(() => {
      call += 1;
      return call === 1 ? new TransientLlmError("timeout", "slow") : "recovered";
    });
    const promise = provider.complete({ purpose: "summary", prompt: "x" });
    await vi.runAllTimersAsync();
    expect((await promise).text).toBe("recovered");
    expect(provider.calls).toBe(2);
  });

  it("propagates auth errors without retry", async () => {
    const provider = new FakeLlmProvider([new AuthLlmError("please run claude login")]);
    const assertion = expect(
      provider.complete({ purpose: "planner", prompt: "x" }),
    ).rejects.toMatchObject({ code: "LLM_ERROR" });
    await vi.runAllTimersAsync();
    await assertion;
    expect(provider.calls).toBe(1);
  });
});
