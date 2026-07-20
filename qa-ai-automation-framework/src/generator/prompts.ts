/**
 * Generation prompts (plan §6.4; PHASE_5_GENERATOR_PLAN §2). Two LLM calls:
 * one per targeted page (page objects) and one per feature group (specs +
 * data). Both embed the conventions block; the spec prompt also embeds the
 * assertion-mapping table and the generated page objects' source. The worked
 * examples are authored inline here (they do NOT reference any deleted
 * `automation/` file), shaped by AGENTS.md.
 */

import { z } from "zod";

import { ASSERTION_MAPPING_BLOCK, CONVENTIONS_BLOCK } from "./conventions.js";

/** Every generation call returns a set of files (path + full content). */
export const GeneratedFilesSchema = z.object({
  files: z
    .array(
      z.object({
        /** Project-relative POSIX path, e.g. "src/pages/LoginPage.ts". */
        path: z.string().min(1),
        content: z.string(),
      }),
    )
    .min(1),
});
export type GeneratedFiles = z.infer<typeof GeneratedFilesSchema>;

export const PAGE_OBJECT_SYSTEM_PROMPT = `You are an expert Playwright automation engineer. You write TypeScript Page Object classes that strictly follow the project conventions below. Return ONLY the files as JSON — no prose.

${CONVENTIONS_BLOCK}`;

export const SPEC_SYSTEM_PROMPT = `You are an expert Playwright automation engineer. You translate a machine-readable test plan into runnable Playwright spec files that strictly follow the project conventions below, driving the page objects you are given. Return ONLY the files as JSON — no prose.

${CONVENTIONS_BLOCK}

${ASSERTION_MAPPING_BLOCK}`;

/** A small, correct Page Object the model anchors on (shape reference only). */
const PAGE_OBJECT_EXAMPLE = `import { type Page, type Locator } from '@playwright/test';
import { BasePage } from './BasePage';

export class LoginPage extends BasePage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    super(page);
    this.usernameInput = page.getByRole('textbox', { name: 'Username' });
    this.passwordInput = page.getByRole('textbox', { name: 'Password' });
    this.loginButton = page.getByRole('button', { name: 'Login' });
    this.errorMessage = page.getByTestId('error');
  }

  async goto(): Promise<void> {
    await this.page.goto('/');
    await this.waitForReady();
  }

  async login(username: string, password: string): Promise<void> {
    await this.usernameInput.fill(username);
    await this.passwordInput.fill(password);
    await this.loginButton.click();
  }
}`;

/** A small spec that uses the page object above (shape reference only). */
const SPEC_EXAMPLE = `import { test, expect } from '../src/fixtures/base';
import { LoginPage } from '../src/pages/LoginPage';

test.describe('Authentication', () => {
  // qa-ai:test_id=tc_001 signature=functional:login:login-valid
  test('valid login leaves the login page @smoke @critical', async ({ page, consoleErrors }) => {
    const login = new LoginPage(page);
    await login.goto();
    await login.login(process.env.QA_USERNAME ?? '', process.env.QA_PASSWORD ?? '');
    await expect(page).toHaveURL(/inventory/);
    expect(consoleErrors).toEqual([]);
  });
});`;

export interface PageObjectPromptInput {
  /** Condensed page descriptor JSON (url, elements, forms). */
  pageJson: string;
  baseUrl: string;
}

export function buildPageObjectPrompt(input: PageObjectPromptInput): string {
  return [
    `## Task\n\nGenerate ONE Page Object class for the page described below. Put it at \`src/pages/<PascalCaseName>.ts\`. Derive locators from the element/form data using the STRICT priority order. Expose an action method for each meaningful interaction (fills, clicks, submits) and readonly locators for everything a test may assert against.\n`,
    `## Page (from the crawled SiteModel)\n\n\`\`\`json\n${input.pageJson}\n\`\`\`\n`,
    `Base URL (do not hard-code it elsewhere — use baseURL-relative paths in goto()): ${input.baseUrl}\n`,
    `## Worked example (shape reference — do NOT copy verbatim)\n\n\`\`\`typescript\n${PAGE_OBJECT_EXAMPLE}\n\`\`\`\n`,
    `## Output\n\nReturn a JSON object \`{ "files": [ { "path": "src/pages/<Name>.ts", "content": "<full file>" } ] }\`.`,
  ].join("\n");
}

export interface SpecPromptInput {
  /** Human name of the feature group (usually the page title / url). */
  groupName: string;
  /** The test cases in this group, as JSON (steps + assertions). */
  testCasesJson: string;
  /** Source of the page objects available to this group (path + content). */
  pageObjectsSource: string;
  baseUrl: string;
  /** True when the plan uses auth placeholders — reminds the model of env reads. */
  hasAuth: boolean;
}

export function buildSpecPrompt(input: SpecPromptInput): string {
  const parts = [
    `## Task\n\nGenerate Playwright spec file(s) for the "${input.groupName}" feature group. Translate each test case's steps and assertions into a Playwright test, driving the page objects below (do NOT call \`page.getByRole\` directly in the spec — go through page objects). Mirror the app URL structure in the spec path under \`tests/\` and use kebab-case names.\n`,
    `## Test cases (from the TestPlan)\n\n\`\`\`json\n${input.testCasesJson}\n\`\`\`\n`,
    `## Available page objects (import and use these — do not redefine them)\n\n\`\`\`typescript\n${input.pageObjectsSource || "// (no page object for this group — drive the page directly, still no raw CSS)"}\n\`\`\`\n`,
    `## Requirements\n` +
      `- Import \`test\`/\`expect\` from the fixtures barrel (e.g. \`../src/fixtures/base\` — use the correct relative depth for the spec's path).\n` +
      `- Prefix EACH test with a traceability comment: \`// qa-ai:test_id=<test_id> signature=<coverage_signature>\`.\n` +
      `- Tag test titles with @smoke/@regression/@critical based on priority (1 → @critical, ≤2 → @smoke).\n` +
      `- Resolve credential placeholders: {{auth_username}} → \`process.env.QA_USERNAME\`, {{auth_password}} → \`process.env.QA_PASSWORD\`, {{auth_login_url}} → a baseURL-relative path. Replace \`{{$timestamp}}\` with \`Date.now()\`.\n` +
      `- Translate assertions using the mapping table. Never emit a fake-passing assertion for ai_evaluate; fixme visual/screenshot_diff.\n` +
      (input.hasAuth
        ? `- Some tests read credentials from env — that is expected.\n`
        : `- This plan has no auth; do not read credentials.\n`),
    `## Worked example (shape reference — do NOT copy verbatim)\n\n\`\`\`typescript\n${SPEC_EXAMPLE}\n\`\`\`\n`,
    `## Output\n\nReturn a JSON object \`{ "files": [ { "path": "tests/<mirror>/<kebab>.spec.ts", "content": "<full file>" }, ... ] }\`. You MAY also emit \`tests/data/*.json\` files for non-credential test data.`,
  ];
  return parts.join("\n");
}
