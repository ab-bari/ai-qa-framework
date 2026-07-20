import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadConfig, resolveEnvValue } from "../../src/core/config/load-config.js";
import { ConfigError } from "../../src/core/errors.js";

let tempRoot: string;

function writeConfig(content: unknown): string {
  const path = join(tempRoot, "qa-config.json");
  writeFileSync(path, JSON.stringify(content), "utf8");
  return path;
}

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "qa-ai-config-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.QA_TEST_SECRET;
});

describe("loadConfig", () => {
  it("loads a minimal config and defaults crawl.target_url from target_url", () => {
    const config = loadConfig(writeConfig({ target_url: "https://www.saucedemo.com" }));
    expect(config.target_url).toBe("https://www.saucedemo.com");
    expect(config.crawl.target_url).toBe("https://www.saucedemo.com");
  });

  it("keeps an explicit crawl.target_url", () => {
    const config = loadConfig(
      writeConfig({
        target_url: "https://www.saucedemo.com",
        crawl: { target_url: "https://www.saucedemo.com/inventory.html" },
      }),
    );
    expect(config.crawl.target_url).toBe("https://www.saucedemo.com/inventory.html");
  });

  it("resolves env: references in auth credentials", () => {
    process.env.QA_TEST_SECRET = "secret_sauce";
    const config = loadConfig(
      writeConfig({
        target_url: "https://www.saucedemo.com",
        auth: {
          login_url: "https://www.saucedemo.com/",
          username: "standard_user",
          password: "env:QA_TEST_SECRET",
        },
      }),
    );
    expect(config.auth?.password).toBe("secret_sauce");
    expect(config.auth?.username).toBe("standard_user");
  });

  it("fails fast when a referenced env var is missing", () => {
    const path = writeConfig({
      target_url: "https://www.saucedemo.com",
      auth: {
        login_url: "https://www.saucedemo.com/",
        username: "standard_user",
        password: "env:QA_TEST_SECRET",
      },
    });
    expect(() => loadConfig(path)).toThrow(ConfigError);
    expect(() => loadConfig(path)).toThrow(/QA_TEST_SECRET/);
  });

  it("raises ConfigError for missing files, bad JSON, and schema violations", () => {
    expect(() => loadConfig(join(tempRoot, "absent.json"))).toThrow(ConfigError);

    const badJson = join(tempRoot, "bad.json");
    writeFileSync(badJson, "{ nope", "utf8");
    expect(() => loadConfig(badJson)).toThrow(/not valid JSON/);

    expect(() => loadConfig(writeConfig({ target_url: 42 }))).toThrow(/Invalid config/);
  });
});

describe("resolveEnvValue", () => {
  it("passes plain values through untouched", () => {
    expect(resolveEnvValue("plain-password", "auth.password")).toBe("plain-password");
  });
});
