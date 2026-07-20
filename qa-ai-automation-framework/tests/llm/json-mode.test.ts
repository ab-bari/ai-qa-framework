import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  completeJson,
  extractJsonCandidate,
  LlmJsonError,
  looksTruncated,
} from "../../src/llm/json-mode.js";
import { TransientLlmError } from "../../src/llm/retry.js";
import type { LlmRequest, LlmResponse } from "../../src/llm/types.js";

const Schema = z.object({ name: z.string(), count: z.number().int() });

function responderOf(...texts: string[]): {
  complete: (req: LlmRequest) => Promise<LlmResponse>;
  calls: () => number;
} {
  let i = 0;
  return {
    complete: (_req: LlmRequest) => Promise.resolve({ text: texts[i++] ?? "", durationMs: 0 }),
    calls: () => i,
  };
}

const baseReq: LlmRequest = { purpose: "planner", prompt: "make json" };

describe("extractJsonCandidate", () => {
  it("prefers the last fenced json block", () => {
    const text = 'prose ```json\n{"a":1}\n``` more ```json\n{"a":2}\n``` tail';
    expect(extractJsonCandidate(text)).toBe('{"a":2}');
  });

  it("falls back to the largest balanced object when no fence is present", () => {
    const text = 'here is {"name":"x","count":3} the object';
    expect(extractJsonCandidate(text)).toBe('{"name":"x","count":3}');
  });

  it("handles braces inside strings", () => {
    const text = '{"pattern":"a{b}c","count":1}';
    expect(extractJsonCandidate(text)).toBe(text);
  });

  it("returns null when there is no object", () => {
    expect(extractJsonCandidate("no json here")).toBeNull();
  });
});

describe("looksTruncated", () => {
  it("flags an unclosed object", () => {
    expect(looksTruncated('{"name":"x","cou')).toBe(true);
  });
  it("flags an unclosed fence", () => {
    expect(looksTruncated('```json\n{"name":"x"}')).toBe(true);
  });
  it("does not flag a complete object", () => {
    expect(looksTruncated('{"name":"x","count":1}')).toBe(false);
  });
  it("does not flag plain prose", () => {
    expect(looksTruncated("just some text")).toBe(false);
  });
});

describe("completeJson pipeline", () => {
  it("parses a valid fenced response on the first try", async () => {
    const r = responderOf('```json\n{"name":"login","count":2}\n```');
    const result = await completeJson({ complete: r.complete }, baseReq, Schema);
    expect(result).toEqual({ name: "login", count: 2 });
    expect(r.calls()).toBe(1);
  });

  it("performs one schema-guided repair round-trip on invalid first output", async () => {
    const r = responderOf(
      '```json\n{"name":"login"}\n```', // missing count
      '```json\n{"name":"login","count":5}\n```',
    );
    const result = await completeJson({ complete: r.complete }, baseReq, Schema);
    expect(result).toEqual({ name: "login", count: 5 });
    expect(r.calls()).toBe(2);
  });

  it("throws LlmJsonError when both attempts fail (deterministic fallback signal)", async () => {
    const r = responderOf('{"name":"x"}', '{"still":"wrong"}');
    await expect(completeJson({ complete: r.complete }, baseReq, Schema)).rejects.toBeInstanceOf(
      LlmJsonError,
    );
    expect(r.calls()).toBe(2);
  });

  it("throws a retryable TransientLlmError on a truncated first response", async () => {
    const r = responderOf('```json\n{"name":"login","cou');
    await expect(completeJson({ complete: r.complete }, baseReq, Schema)).rejects.toBeInstanceOf(
      TransientLlmError,
    );
    // Truncation is detected before the repair round-trip.
    expect(r.calls()).toBe(1);
  });
});
