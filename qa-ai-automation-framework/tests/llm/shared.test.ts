import { describe, expect, it } from "vitest";

import { looksLikeAuthError, resolveModel, withImagePrompt } from "../../src/llm/shared.js";

describe("resolveModel", () => {
  it("maps fast to haiku regardless of configured model", () => {
    expect(resolveModel("fast", "opus")).toBe("haiku");
    expect(resolveModel("fast", "")).toBe("haiku");
  });

  it("uses the configured model for default, or undefined when unset", () => {
    expect(resolveModel("default", "sonnet")).toBe("sonnet");
    expect(resolveModel("default", "")).toBeUndefined();
    expect(resolveModel(undefined, "opus")).toBe("opus");
  });
});

describe("withImagePrompt", () => {
  it("returns the prompt unchanged when there are no images", () => {
    expect(withImagePrompt({ purpose: "echo", prompt: "hi" })).toBe("hi");
  });

  it("appends Read-tool instructions listing each absolute path", () => {
    const out = withImagePrompt({
      purpose: "ai-evaluate",
      prompt: "Is the banner visible?",
      imagePaths: ["C:/a/shot.png", "C:/b/shot2.png"],
    });
    expect(out).toContain("Is the banner visible?");
    expect(out).toContain("using the Read tool");
    expect(out).toContain("- C:/a/shot.png");
    expect(out).toContain("- C:/b/shot2.png");
  });
});

describe("looksLikeAuthError", () => {
  it("matches common auth failure phrasings", () => {
    for (const s of [
      "Please run `claude login`",
      "You are not authenticated",
      "authentication_failed",
      "Invalid API key",
      "Insufficient credit balance",
    ]) {
      expect(looksLikeAuthError(s)).toBe(true);
    }
  });

  it("does not match ordinary output", () => {
    expect(looksLikeAuthError("pong")).toBe(false);
    expect(looksLikeAuthError("the test passed")).toBe(false);
  });
});
