import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildPlaywrightArgs, reporterEnv } from "../../src/automation-runner/index.js";

describe("buildPlaywrightArgs", () => {
  it("emits the bare `playwright test` with no options", () => {
    expect(buildPlaywrightArgs({ projectDir: "x" })).toEqual(["playwright", "test"]);
  });

  it("threads through spec, grep, headed and workers in order", () => {
    const args = buildPlaywrightArgs({
      projectDir: "x",
      spec: "tests/auth/login.spec.ts",
      grep: "@smoke",
      headed: true,
      workers: 2,
    });
    expect(args).toEqual([
      "playwright",
      "test",
      "tests/auth/login.spec.ts",
      "--grep",
      "@smoke",
      "--headed",
      "--workers",
      "2",
    ]);
  });

  it("omits empty grep/spec and a falsy headed flag", () => {
    const args = buildPlaywrightArgs({ projectDir: "x", grep: "", spec: "", headed: false });
    expect(args).toEqual(["playwright", "test"]);
  });
});

describe("reporterEnv", () => {
  it("redirects both reporters into the run folder (JSON via _OUTPUT_FILE)", () => {
    const runDir = join("root", ".qa", "automation-runs", "run-20260721-120000");
    const env = reporterEnv(runDir);
    expect(env.PLAYWRIGHT_HTML_OUTPUT_DIR).toBe(join(runDir, "playwright-report"));
    // Must be _OUTPUT_FILE — the generated config's `outputFile` beats
    // _OUTPUT_DIR / _OUTPUT_NAME, but _OUTPUT_FILE wins over the config.
    expect(env.PLAYWRIGHT_JSON_OUTPUT_FILE).toBe(join(runDir, "results.json"));
    expect(env.PLAYWRIGHT_HTML_OPEN).toBe("never");
  });
});
