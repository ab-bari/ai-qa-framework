/**
 * LLMProvider interface (plan §5). Every AI-touching component depends only
 * on this interface — the provider is chosen ONCE in `createProvider` and
 * nothing else branches on which one is active.
 */

import type { z } from "zod";

/** Drives debug-log naming and the timeout profile (plan §5). */
export type LlmPurpose =
  | "planner"
  | "selector-fallback"
  | "healer-triage"
  | "healer-patch"
  | "auth-detect"
  | "ai-evaluate"
  | "summary"
  | "echo";

export interface LlmRequest {
  purpose: LlmPurpose;
  prompt: string;
  system?: string;
  /** Absolute paths. Vision calls must also set allowedTools/--allowedTools to ["Read"] only. */
  imagePaths?: string[];
  /** Mapped per-provider; "default" is the provider's normal model, "fast" a cheaper/quicker one. */
  model?: "default" | "fast";
  timeoutMs?: number;
}

export interface LlmResponse {
  text: string;
  durationMs: number;
  /** Provider-specific raw result payload, kept for debug logging only. */
  raw?: unknown;
}

export interface LlmHealthCheck {
  ok: boolean;
  detail: string;
}

export interface LLMProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  completeJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<T>;
  /** Used by `qa-ai doctor`. Never throws — reports failure in the result instead. */
  healthCheck(): Promise<LlmHealthCheck>;
}

/** Per-purpose timeout profile (plan §5). */
export const LLM_TIMEOUT_PROFILE_MS: Record<LlmPurpose, number> = {
  planner: 300_000,
  "healer-patch": 300_000,
  "selector-fallback": 90_000,
  "healer-triage": 90_000,
  "auth-detect": 90_000,
  "ai-evaluate": 90_000,
  summary: 120_000,
  echo: 60_000,
};

export function timeoutForPurpose(purpose: LlmPurpose, override?: number): number {
  return override ?? LLM_TIMEOUT_PROFILE_MS[purpose];
}
