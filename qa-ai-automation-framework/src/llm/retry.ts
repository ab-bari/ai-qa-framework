/**
 * Retry policy for LLM calls (plan §5): max 3 attempts, backoff 2s/8s/30s +
 * jitter, on spawn failure / transient stderr / timeout / truncation.
 * NEVER retry auth errors — those fail fast with a `claude login` remediation.
 */

import { LlmError } from "../core/errors.js";

export type TransientReason = "spawn-failure" | "transient-stderr" | "timeout" | "truncation";

/** Thrown by providers to signal a specific, classifiable failure. */
export class TransientLlmError extends Error {
  readonly reason: TransientReason;
  constructor(reason: TransientReason, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "TransientLlmError";
    this.reason = reason;
  }
}

/** Thrown by providers when the local Claude Code / CLI is not authenticated. */
export class AuthLlmError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AuthLlmError";
  }
}

const BACKOFF_MS = [2_000, 8_000, 30_000];
const MAX_ATTEMPTS = 3;

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * (ms * 0.2));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface WithRetryOptions {
  purpose: string;
  maxAttempts?: number;
}

/**
 * Run `attempt()` up to `maxAttempts` times. Retries only on `TransientLlmError`;
 * `AuthLlmError` and anything else propagate immediately. On exhaustion, throws
 * an `LlmError` wrapping the last failure with a remediation hint.
 */
export async function withRetry<T>(
  attempt: (attemptNumber: number) => Promise<T>,
  options: WithRetryOptions,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  let lastError: unknown;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    try {
      return await attempt(attemptNumber);
    } catch (error) {
      if (error instanceof AuthLlmError) {
        throw new LlmError(`${options.purpose}: not authenticated — ${error.message}`, {
          remediation: "Run `claude login` to authorize Claude Code, then retry.",
          cause: error,
        });
      }
      lastError = error;
      if (!(error instanceof TransientLlmError) || attemptNumber === maxAttempts) {
        break;
      }
      const backoff = BACKOFF_MS[attemptNumber - 1] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 30_000;
      await sleep(jitter(backoff));
    }
  }

  if (lastError instanceof TransientLlmError) {
    throw new LlmError(
      `${options.purpose}: failed after ${String(maxAttempts)} attempts (${lastError.reason}): ${lastError.message}`,
      {
        remediation: "Check network connectivity and Claude Code status, then retry.",
        cause: lastError,
      },
    );
  }
  throw lastError;
}
