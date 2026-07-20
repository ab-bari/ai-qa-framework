/**
 * Typed error hierarchy (plan §8). Components' entry points are the only
 * try/catch tier; the CLI maps these to exit codes and prints
 * `code: message → remediation`.
 */

export type QaErrorCode =
  "CONFIG_ERROR" | "ARTIFACT_ERROR" | "LLM_ERROR" | "BROWSER_ERROR" | "INTERNAL_ERROR";

export interface QaErrorOptions {
  remediation?: string;
  cause?: unknown;
}

export class QaError extends Error {
  readonly code: QaErrorCode;
  readonly remediation: string | undefined;
  /** CLI exit code (plan §7): 1 component error, 2 config/input error. */
  readonly exitCode: number;

  constructor(code: QaErrorCode, message: string, options: QaErrorOptions = {}, exitCode = 1) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.remediation = options.remediation;
    this.exitCode = exitCode;
  }
}

export class ConfigError extends QaError {
  constructor(message: string, options: QaErrorOptions = {}) {
    super("CONFIG_ERROR", message, options, 2);
  }
}

export class ArtifactError extends QaError {
  constructor(message: string, options: QaErrorOptions = {}) {
    super("ARTIFACT_ERROR", message, options, 2);
  }
}

export class LlmError extends QaError {
  constructor(message: string, options: QaErrorOptions = {}) {
    super("LLM_ERROR", message, options, 1);
  }
}

export class BrowserError extends QaError {
  constructor(message: string, options: QaErrorOptions = {}) {
    super("BROWSER_ERROR", message, options, 1);
  }
}
