import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { scaffoldProject } from "../../src/generator/scaffold.js";

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "qa-ai-scaffold-"));
});
afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("scaffoldProject", () => {
  it("copies the template, strips .hbs, restores .gitignore, and substitutes tokens", () => {
    const emitted = scaffoldProject(outDir, {
      projectName: "saucedemo-tests",
      baseUrl: "https://www.saucedemo.com",
    });

    // .hbs stripped
    expect(emitted).toContain("package.json");
    expect(emitted).not.toContain("package.json.hbs");
    expect(existsSync(join(outDir, "package.json"))).toBe(true);

    // gitignore restored to dotfile
    expect(emitted).toContain(".gitignore");
    expect(existsSync(join(outDir, ".gitignore"))).toBe(true);

    // token substitution
    const pkg = readFileSync(join(outDir, "package.json"), "utf8");
    expect(pkg).toContain('"name": "saucedemo-tests"');
    const config = readFileSync(join(outDir, "playwright.config.ts"), "utf8");
    expect(config).toContain("baseURL: 'https://www.saucedemo.com'");

    // core contracts present
    expect(existsSync(join(outDir, "src", "fixtures", "base.ts"))).toBe(true);
    expect(existsSync(join(outDir, "src", "pages", "BasePage.ts"))).toBe(true);
    expect(existsSync(join(outDir, "tests", "seed.spec.ts"))).toBe(true);

    // no unsubstituted tokens remain anywhere
    for (const rel of emitted) {
      const content = readFileSync(join(outDir, ...rel.split("/")), "utf8");
      expect(content).not.toMatch(/\{\{(projectName|baseUrl)\}\}/);
    }
  });

  it("emits the consoleErrors fixture in base.ts", () => {
    scaffoldProject(outDir, { projectName: "x-tests", baseUrl: "https://example.com" });
    const base = readFileSync(join(outDir, "src", "fixtures", "base.ts"), "utf8");
    expect(base).toContain("consoleErrors");
    expect(base).toContain("isResourceLoadNoise");
  });
});
