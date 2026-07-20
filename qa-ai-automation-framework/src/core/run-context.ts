/**
 * Per-command context (plan §8): no module-level mutable state — each CLI
 * command builds a RunContext and passes it down explicitly.
 */

import type { Logger } from "./logger.js";
import type { Workspace } from "./workspace.js";
import type { LLMProvider } from "../llm/types.js";
import type { FrameworkConfig } from "../schemas/config.js";

export interface RunContext {
  config: FrameworkConfig;
  workspace: Workspace;
  logger: Logger;
  /** Present for AI-touching commands; absent when no provider is needed. */
  llm?: LLMProvider | undefined;
}
