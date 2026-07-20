import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import type { RunContext } from "../../src/core/run-context.js";
import { Workspace } from "../../src/core/workspace.js";
import { runGenerate } from "../../src/generator/index.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { FrameworkConfigSchema } from "../../src/schemas/config.js";
import { GenerationManifestSchema } from "../../src/schemas/generation-manifest.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";
import { TestPlanSchema } from "../../src/schemas/test-plan.js";
import type { LlmRequest } from "../../src/llm/types.js";

function fenced(obj: unknown): string {
  return "```json\n" + JSON.stringify(obj) + "\n```";
}

const PAGE_OBJECT_RESPONSE = fenced({
  files: [
    {
      path: "src/pages/LoginPage.ts",
      content: [
        "import { type Page, type Locator } from '@playwright/test';",
        "import { BasePage } from './BasePage';",
        "export class LoginPage extends BasePage {",
        "  readonly usernameInput: Locator;",
        "  constructor(page: Page) {",
        "    super(page);",
        "    this.usernameInput = page.getByTestId('username');",
        "  }",
        "  async goto(): Promise<void> { await this.page.goto('/'); }",
        "}",
      ].join("\n"),
    },
  ],
});

const SPEC_RESPONSE = fenced({
  files: [
    {
      path: "tests/auth/login.spec.ts",
      content: [
        "import { test, expect } from '../../src/fixtures/base';",
        "import { LoginPage } from '../../src/pages/LoginPage';",
        "test.describe('Authentication', () => {",
        "  // qa-ai:test_id=tc_001 signature=functional:a1b2c3d4e5f6:login-valid",
        "  test('valid login @smoke @critical', async ({ page, consoleErrors }) => {",
        "    const login = new LoginPage(page);",
        "    await login.goto();",
        "    await login.usernameInput.fill(process.env.QA_USERNAME ?? '');",
        "    await expect(page).toHaveURL(/inventory/);",
        "    expect(consoleErrors).toEqual([]);",
        "  });",
        "});",
      ].join("\n"),
    },
    { path: "tests/data/login.json", content: '{ "note": "no credentials here" }' },
  ],
});

function responder(req: LlmRequest): string {
  if (req.system?.includes("Page Object classes") === true) {
    return PAGE_OBJECT_RESPONSE;
  }
  return SPEC_RESPONSE;
}

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "qa-ai-gen-"));
});
afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("runGenerate", () => {
  it("scaffolds, generates POs + specs, writes .env.example and a valid manifest", async () => {
    const siteModelRaw: unknown = JSON.parse(
      readFileSync(new URL("../fixtures/site-model.json", import.meta.url), "utf8"),
    );
    const siteModel = SiteModelSchema.parse(siteModelRaw);
    const plan = TestPlanSchema.parse({
      plan_id: "plan-test",
      generated_at: "2026-07-21T00:00:00.000Z",
      target_url: "https://www.saucedemo.com",
      test_cases: [
        {
          test_id: "tc_001",
          name: "Valid login",
          category: "functional",
          priority: 1,
          target_page_id: "a1b2c3d4e5f6",
          coverage_signature: "functional:a1b2c3d4e5f6:login-valid",
          requires_auth: false,
          steps: [
            {
              action_type: "fill",
              selector: '[data-test="username"]',
              value: "{{auth_username}}",
              description: "fill username",
            },
          ],
          assertions: [
            {
              assertion_type: "url_matches",
              expected_value: "inventory",
              description: "left login",
            },
          ],
        },
      ],
    });

    const ctx: RunContext = {
      config: FrameworkConfigSchema.parse({ target_url: "https://www.saucedemo.com" }),
      workspace: new Workspace(join(tempRoot, ".qa")),
      logger: createLogger({ level: "error" }),
      llm: new FakeLlmProvider(responder),
    };

    const outputDir = join(tempRoot, "automation-tests");
    const result = await runGenerate(ctx, plan, siteModel, {
      outputDir,
      siteModelPath: ".qa/site-model/site-model.json",
      skipValidate: true,
    });

    expect(result.pageObjectCount).toBe(1);
    expect(result.specCount).toBe(1);

    // Generated files landed on disk.
    expect(existsSync(join(outputDir, "src", "pages", "LoginPage.ts"))).toBe(true);
    const spec = readFileSync(join(outputDir, "tests", "auth", "login.spec.ts"), "utf8");
    expect(spec).toContain("qa-ai:test_id=tc_001");

    // Scaffold present.
    expect(existsSync(join(outputDir, "package.json"))).toBe(true);
    expect(existsSync(join(outputDir, "src", "fixtures", "base.ts"))).toBe(true);

    // .env.example lists the credential var read in the spec.
    const envExample = readFileSync(join(outputDir, ".env.example"), "utf8");
    expect(envExample).toContain("QA_USERNAME=");

    // Manifest validates and maps the spec to its source test id.
    const manifestRaw: unknown = JSON.parse(
      readFileSync(join(outputDir, "generation-manifest.json"), "utf8"),
    );
    const manifest = GenerationManifestSchema.parse(manifestRaw);
    expect(manifest.plan_id).toBe("plan-test");
    const specEntry = manifest.files.find((f) => f.path === "tests/auth/login.spec.ts");
    expect(specEntry?.kind).toBe("spec");
    expect(specEntry?.test_ids).toEqual(["tc_001"]);
    const poEntry = manifest.files.find((f) => f.path === "src/pages/LoginPage.ts");
    expect(poEntry?.kind).toBe("page-object");
    expect(manifest.files.some((f) => f.kind === "scaffold")).toBe(true);
    expect(manifest.lint_warnings).toEqual([]);
  });
});
