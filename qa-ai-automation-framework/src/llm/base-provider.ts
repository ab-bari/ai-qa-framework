/**
 * Shared LLMProvider base: `complete` and `completeJson` are implemented once
 * here (retry policy + the json-mode pipeline), so concrete providers only
 * implement `rawComplete` (a single, timeout-bounded exchange), `name`, and
 * `healthCheck`. This keeps "how retry and JSON mode work" in exactly one
 * place (plan §5).
 */

import type { z } from "zod";

import type { Workspace } from "../core/workspace.js";
import { writeDebugLog } from "./debug-log.js";
import { completeJson as runCompleteJson } from "./json-mode.js";
import { withRetry } from "./retry.js";
import type { LLMProvider, LlmHealthCheck, LlmRequest, LlmResponse } from "./types.js";

export abstract class BaseLlmProvider implements LLMProvider {
  abstract readonly name: string;
  protected readonly workspace: Workspace | undefined;

  constructor(workspace?: Workspace) {
    this.workspace = workspace;
  }

  /** One exchange, no retry. Must enforce its own timeout and throw Transient/Auth errors. */
  protected abstract rawComplete(req: LlmRequest): Promise<LlmResponse>;

  abstract healthCheck(): Promise<LlmHealthCheck>;

  /** rawComplete + best-effort debug logging of the exchange. */
  private async loggedRawComplete(req: LlmRequest): Promise<LlmResponse> {
    try {
      const response = await this.rawComplete(req);
      if (this.workspace !== undefined) {
        writeDebugLog(this.workspace, { provider: this.name, request: req, response });
      }
      return response;
    } catch (error) {
      if (this.workspace !== undefined) {
        writeDebugLog(this.workspace, { provider: this.name, request: req, error });
      }
      throw error;
    }
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    return withRetry(() => this.loggedRawComplete(req), { purpose: req.purpose });
  }

  async completeJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<T> {
    // Retry wraps the whole extract → parse → one-repair pipeline so a
    // truncated first response (TransientLlmError) re-runs it end to end.
    return withRetry(
      () => runCompleteJson({ complete: (r) => this.loggedRawComplete(r) }, req, schema),
      { purpose: req.purpose },
    );
  }
}
