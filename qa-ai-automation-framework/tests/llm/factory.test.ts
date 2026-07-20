import { describe, expect, it } from "vitest";

import { ConfigError } from "../../src/core/errors.js";
import { createProvider } from "../../src/llm/factory.js";
import { FrameworkConfigSchema } from "../../src/schemas/config.js";

function configWith(provider: string): ReturnType<typeof FrameworkConfigSchema.parse> {
  return FrameworkConfigSchema.parse({ target_url: "https://x.com", ai_provider: provider });
}

describe("createProvider", () => {
  it("returns the Claude Code (Agent SDK) provider by default", () => {
    expect(createProvider(configWith("claude-code")).name).toBe("claude-code");
  });

  it("returns the CLI fallback provider for claude-code-cli", () => {
    expect(createProvider(configWith("claude-code-cli")).name).toBe("claude-code-cli");
  });

  it("rejects reserved providers with a ConfigError and remediation", () => {
    expect(() => createProvider(configWith("anthropic-api"))).toThrow(ConfigError);
    expect(() => createProvider(configWith("ollama"))).toThrow(/reserved but not implemented/);
  });
});
