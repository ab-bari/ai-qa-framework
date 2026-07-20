import { describe, expect, it } from "vitest";

import { ASSERTION_TO_PLAYWRIGHT, lintGeneratedFiles } from "../../src/generator/conventions.js";
import { AssertionTypeSchema } from "../../src/schemas/test-plan.js";

describe("lintGeneratedFiles", () => {
  it("flags @playwright/test imports only inside spec files", () => {
    const violations = lintGeneratedFiles([
      { path: "tests/auth/login.spec.ts", content: "import { test } from '@playwright/test';" },
      { path: "src/pages/LoginPage.ts", content: "import { type Page } from '@playwright/test';" },
    ]);
    expect(violations).toHaveLength(1);
    expect(violations[0]?.rule).toBe("no-playwright-test-import-in-specs");
    expect(violations[0]?.file).toBe("tests/auth/login.spec.ts");
  });

  it("flags waitForTimeout, waitForSelector, raw locators, and skipped tests", () => {
    const rules = lintGeneratedFiles([
      {
        path: "tests/x.spec.ts",
        content: [
          "await page.waitForTimeout(1000);",
          "await page.waitForSelector('.foo');",
          "const x = page.locator('.bar');",
          "test.skip('nope', async () => {});",
        ].join("\n"),
      },
    ]).map((v) => v.rule);
    expect(rules).toContain("no-wait-for-timeout");
    expect(rules).toContain("no-wait-for-selector");
    expect(rules).toContain("no-raw-css-or-xpath-locator");
    expect(rules).toContain("no-skipped-tests");
  });

  it("passes clean, convention-following code", () => {
    const clean = [
      "import { test, expect } from '../src/fixtures/base';",
      "import { LoginPage } from '../src/pages/LoginPage';",
      "test('valid login @smoke', async ({ page }) => {",
      "  const login = new LoginPage(page);",
      "  await login.goto();",
      "  await expect(page).toHaveURL(/inventory/);",
      "});",
    ].join("\n");
    expect(lintGeneratedFiles([{ path: "tests/auth/login.spec.ts", content: clean }])).toEqual([]);
  });

  it("does not fire on commented-out examples", () => {
    const commented = "// await page.waitForTimeout(1000); // example of what NOT to do";
    expect(lintGeneratedFiles([{ path: "tests/x.spec.ts", content: commented }])).toEqual([]);
  });

  it("honors the // qa-ai:allow-locator escape hatch", () => {
    const allowed = "const el = page.locator('#legacy'); // qa-ai:allow-locator justified";
    expect(lintGeneratedFiles([{ path: "src/pages/Legacy.ts", content: allowed }])).toEqual([]);
  });

  it("maps every AssertionType to a Playwright expression", () => {
    for (const type of AssertionTypeSchema.options) {
      expect(ASSERTION_TO_PLAYWRIGHT[type]).toBeTruthy();
    }
  });
});
