import { describe, expect, it } from "vitest";

import { FrameworkConfigSchema } from "../../src/schemas/config.js";

describe("FrameworkConfigSchema", () => {
  it("fills every default from just a target_url", () => {
    const config = FrameworkConfigSchema.parse({ target_url: "https://www.saucedemo.com" });
    expect(config.auth).toBeNull();
    expect(config.crawl.max_pages).toBe(10);
    expect(config.crawl.viewport).toEqual({ width: 1280, height: 720, name: "desktop" });
    expect(config.categories).toEqual(["functional", "security"]);
    expect(config.max_tests_per_run).toBe(20);
    expect(config.ai_provider).toBe("claude-code");
    expect(config.workspace_dir).toBe(".qa");
  });

  it("accepts a full config and survives a JSON round-trip", () => {
    const config = FrameworkConfigSchema.parse({
      target_url: "https://www.saucedemo.com",
      auth: {
        login_url: "https://www.saucedemo.com/",
        username: "standard_user",
        password: "env:QA_AUTH_PASSWORD",
        success_indicator: ".inventory_list",
      },
      crawl: { max_pages: 15, viewport: { width: 1920, height: 1080, name: "desktop-hd" } },
      categories: ["functional"],
      ai_provider: "claude-code-cli",
      hints: ["Focus on checkout"],
      workspace_dir: ".qa-custom",
    });
    expect(config.auth?.auto_detect).toBe(true);
    const reparsed = FrameworkConfigSchema.parse(JSON.parse(JSON.stringify(config)));
    expect(reparsed).toEqual(config);
  });

  it("rejects unknown providers and categories", () => {
    expect(
      FrameworkConfigSchema.safeParse({ target_url: "https://x.com", ai_provider: "openai" })
        .success,
    ).toBe(false);
    expect(
      FrameworkConfigSchema.safeParse({ target_url: "https://x.com", categories: ["load"] })
        .success,
    ).toBe(false);
  });

  it("keeps reserved provider enum members parseable (plan §10 schema hooks)", () => {
    for (const reserved of ["anthropic-api", "ollama"]) {
      expect(
        FrameworkConfigSchema.safeParse({ target_url: "https://x.com", ai_provider: reserved })
          .success,
      ).toBe(true);
    }
  });

  it("requires auth to be complete when present", () => {
    expect(
      FrameworkConfigSchema.safeParse({
        target_url: "https://x.com",
        auth: { login_url: "https://x.com/login", username: "u" },
      }).success,
    ).toBe(false);
  });
});
