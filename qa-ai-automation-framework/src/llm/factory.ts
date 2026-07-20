/**
 * Provider selection happens ONCE, here (plan §5). Nothing else in the
 * codebase may branch on `config.ai_provider` — components receive an
 * `LLMProvider` and depend only on the interface.
 */

import { ConfigError } from "../core/errors.js";
import type { Workspace } from "../core/workspace.js";
import type { FrameworkConfig } from "../schemas/config.js";
import { ClaudeCliProvider } from "./claude-cli-provider.js";
import { ClaudeCodeProvider } from "./claude-code-provider.js";
import type { LLMProvider } from "./types.js";

export interface CreateProviderOptions {
  /** Debug logs are written here when provided (plan §5). */
  workspace?: Workspace;
}

export function createProvider(
  config: FrameworkConfig,
  options: CreateProviderOptions = {},
): LLMProvider {
  const shared = {
    configuredModel: config.ai_model,
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
  };
  switch (config.ai_provider) {
    case "claude-code":
      return new ClaudeCodeProvider(shared);
    case "claude-code-cli":
      return new ClaudeCliProvider(shared);
    case "anthropic-api":
    case "ollama":
      throw new ConfigError(
        `ai_provider '${config.ai_provider}' is reserved but not implemented in v1.`,
        {
          remediation: 'Set "ai_provider" to "claude-code" (default) or "claude-code-cli".',
        },
      );
    default: {
      const exhaustive: never = config.ai_provider;
      throw new ConfigError(`Unknown ai_provider: ${String(exhaustive)}`);
    }
  }
}
