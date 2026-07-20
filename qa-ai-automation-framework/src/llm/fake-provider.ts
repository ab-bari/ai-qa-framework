/**
 * FakeLlmProvider — first-class test utility (plan §8, §11). Returns canned
 * responses so unit and integration tests run with no network or real LLM.
 * It extends BaseLlmProvider so tests exercise the real json-mode and retry
 * pipeline against scripted `rawComplete` output.
 */

import { BaseLlmProvider } from "./base-provider.js";
import type { LlmHealthCheck, LlmRequest, LlmResponse } from "./types.js";

export type FakeResponder = (req: LlmRequest, callIndex: number) => string | Error;

export class FakeLlmProvider extends BaseLlmProvider {
  readonly name = "fake";
  private readonly responder: FakeResponder;
  private callCount = 0;
  /** Every request passed to rawComplete, in order — for assertions. */
  readonly requests: LlmRequest[] = [];

  /**
   * @param responder Function or array of canned outputs. A returned string
   *   becomes the response text; a returned/thrown Error is thrown (use the
   *   Transient/Auth error classes to exercise retry paths). An array is
   *   consumed one entry per call.
   */
  constructor(responder: FakeResponder | (string | Error)[]) {
    super(undefined);
    if (Array.isArray(responder)) {
      const canned = responder;
      this.responder = (_req, index) => canned[index] ?? "";
    } else {
      this.responder = responder;
    }
  }

  protected rawComplete(req: LlmRequest): Promise<LlmResponse> {
    const index = this.callCount++;
    this.requests.push(req);
    const outcome = this.responder(req, index);
    if (outcome instanceof Error) {
      return Promise.reject(outcome);
    }
    return Promise.resolve({ text: outcome, durationMs: 0 });
  }

  get calls(): number {
    return this.callCount;
  }

  healthCheck(): Promise<LlmHealthCheck> {
    return Promise.resolve({ ok: true, detail: "fake provider" });
  }
}
