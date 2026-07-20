/**
 * The `automation/AGENTS.md` ruleset, encoded as (a) a prompt block embedded in
 * the generation prompts and (b) a set of regex lint checks run by the
 * validation loop (plan §6.4; PHASE_5_GENERATOR_PLAN §2, §3). The assertion-
 * type → Playwright mapping table lives here too, used by both the spec prompt
 * and (informationally) the lint.
 *
 * The lint is a heuristic safety net that catches the coarse violations the
 * prompt is meant to prevent — it is enforcement in addition to prompting
 * (plan §10: "generated code violating AGENTS.md — enforced by validation-loop
 * lint, not just prompts"), not a full parser.
 */

import type { AssertionType } from "../schemas/test-plan.js";

/** The AGENTS.md ruleset as a prompt block, embedded in every generation call. */
export const CONVENTIONS_BLOCK = `## Framework conventions — NON-NEGOTIABLE

### Imports
- In spec files (tests/**), import \`test\` and \`expect\` ONLY from the fixtures barrel
  (e.g. \`import { test, expect } from '../src/fixtures/base'\`) — NEVER from '@playwright/test'.
- Import page objects from 'src/pages/…' and test data from 'tests/data/…' (never inline large data).
- Page object files (src/pages/**) may import the \`Page\`/\`Locator\` TYPES from '@playwright/test'.

### File naming & location
- Spec file names are kebab-case ending in '.spec.ts' and mirror the app URL structure under tests/.
- One feature area per \`test.describe\` block; a descriptive describe title.

### Page Object contract
- One class per page in src/pages/, extending BasePage (from '../pages/BasePage' or 'src/pages/BasePage').
- Constructor takes \`page: Page\` only. Call \`super(page)\`.
- ALL locators are \`readonly\` properties initialised in the constructor.
- Action methods return \`Promise<void>\` OR the next page object. NO \`expect()\` inside page objects.
- Provide a \`goto()\` implementation (navigate to the page's path).

### Locator priority (STRICT — stop at the first that resolves uniquely)
1. \`page.getByRole(role, { name })\` with the accessible name
2. \`page.getByLabel(text)\` for form fields
3. \`page.getByPlaceholder(text)\` when there is no label
4. \`page.getByTestId(id)\` — the test-id attribute is configured as \`data-test\`
5. \`page.getByText(text)\` only for genuinely static UI text
- CSS selectors, XPath, \`page.locator('css')\`, and nth-based selection are FORBIDDEN.

### Assertions
- Web-first assertions only (\`await expect(locator).toBeVisible()\`, \`toHaveText()\`, \`toHaveCount()\`).
- NEVER use \`page.waitForTimeout\`. NEVER use \`page.waitForSelector\` — rely on locator auto-waiting.
- Tag every test title with @smoke, @regression, and/or @critical as appropriate.
- Use \`test.step(...)\` when a flow has more than 3 actions.

### Credentials
- NEVER hard-code credentials. Read them from \`process.env\` (e.g. \`process.env.QA_USERNAME\`).
- The placeholder tokens {{auth_username}}, {{auth_password}}, {{auth_login_url}} become
  \`process.env.QA_USERNAME\`, \`process.env.QA_PASSWORD\`, and the baseURL-relative login path.

### Forbidden
- Do NOT skip, \`.fixme\`, or comment out a test just to make it pass (except the documented
  screenshot_diff / visual case, which is intentionally fixme'd in v1).
- Do NOT weaken an assertion's intent.`;

/** Human-readable assertion-type → Playwright mapping, embedded in the spec prompt. */
export const ASSERTION_MAPPING_BLOCK = `## Assertion-type → Playwright mapping (translate each plan assertion using this table)

- element_visible      → await expect(locator).toBeVisible()
- element_hidden       → await expect(locator).toBeHidden()
- text_contains        → await expect(locator).toContainText(expected)
- text_equals          → await expect(locator).toHaveText(expected)
- text_matches         → await expect(locator).toHaveText(/expected/)
- url_matches          → await expect(page).toHaveURL(/expected/)
- page_title_contains  → await expect(page).toHaveTitle(/expected/)
- element_count        → await expect(locator).toHaveCount(Number(expected))
- page_loaded          → await pageObject.waitForReady() then await expect(page).toHaveURL(/…/)
- no_console_errors    → request the \`consoleErrors\` fixture; await expect(consoleErrors).toEqual([])
- network_request_made → await page.waitForResponse(r => r.url().includes(expected))
- response_status      → await page.waitForResponse(r => r.url().includes(sel) && r.status() === Number(expected))
- ai_evaluate          → translate the natural-language expectation into a CONCRETE web-first assertion
                         when feasible (e.g. "products sorted Z→A" → read the texts and assert ordering);
                         when NOT feasible, emit a \`test.step\` with a \`// qa-ai:ai_evaluate <intent>\` TODO
                         and NO fake-passing assertion.
- screenshot_diff (and any visual-only assertion) → \`test.fixme(…)\` with a comment; visual is out of scope in v1.`;

/** The Playwright expression each assertion type maps to (reference / test oracle). */
export const ASSERTION_TO_PLAYWRIGHT: Record<AssertionType, string> = {
  element_visible: "expect(locator).toBeVisible()",
  element_hidden: "expect(locator).toBeHidden()",
  text_contains: "expect(locator).toContainText(value)",
  text_equals: "expect(locator).toHaveText(value)",
  text_matches: "expect(locator).toHaveText(/value/)",
  url_matches: "expect(page).toHaveURL(/value/)",
  page_title_contains: "expect(page).toHaveTitle(/value/)",
  element_count: "expect(locator).toHaveCount(n)",
  page_loaded: "expect(page).toHaveURL(...) + waitForReady()",
  no_console_errors: "expect(consoleErrors).toEqual([])",
  network_request_made: "page.waitForResponse(predicate)",
  response_status: "page.waitForResponse(status predicate)",
  ai_evaluate: "concrete web-first assertion or // qa-ai:ai_evaluate TODO",
  screenshot_diff: "test.fixme (visual out of scope in v1)",
};

export interface LintViolation {
  file: string;
  line: number;
  rule: string;
  message: string;
}

interface LintRule {
  rule: string;
  message: string;
  /** Applies to a file path? */
  applies: (path: string) => boolean;
  /** Matches an offending line? */
  test: (line: string) => boolean;
}

const isSpec = (path: string): boolean => /(^|\/)tests\/.*\.(spec|test)\.ts$/.test(path);
const isPageObject = (path: string): boolean => /(^|\/)src\/pages\/.*\.ts$/.test(path);
const isSpecOrPage = (path: string): boolean => isSpec(path) || isPageObject(path);

/**
 * Raw-CSS / XPath detection. `page.locator(...)` and `xpath=` bypass the
 * required getBy* priority. An inline `// qa-ai:allow-locator` escapes it for
 * the rare justified case (mirrors AGENTS.md "unless approved").
 */
function usesRawLocator(line: string): boolean {
  if (line.includes("// qa-ai:allow-locator")) {
    return false;
  }
  return /\.locator\s*\(/.test(line) || /xpath\s*=/.test(line) || line.includes("page.$(");
}

const LINT_RULES: LintRule[] = [
  {
    rule: "no-playwright-test-import-in-specs",
    message: "spec files must import test/expect from the fixtures barrel, not '@playwright/test'",
    applies: isSpec,
    test: (line) => /from\s+['"]@playwright\/test['"]/.test(line),
  },
  {
    rule: "no-wait-for-timeout",
    message: "waitForTimeout is banned — rely on locator auto-waiting",
    applies: isSpecOrPage,
    test: (line) => /waitForTimeout\s*\(/.test(line),
  },
  {
    rule: "no-wait-for-selector",
    message: "waitForSelector is banned — use web-first assertions on locators",
    applies: isSpecOrPage,
    test: (line) => /waitForSelector\s*\(/.test(line),
  },
  {
    rule: "no-raw-css-or-xpath-locator",
    message:
      "raw CSS/XPath locators are forbidden — use getByRole/getByLabel/getByPlaceholder/getByTestId/getByText",
    applies: isSpecOrPage,
    test: usesRawLocator,
  },
  {
    rule: "no-skipped-tests",
    message:
      "do not skip/only tests to force green (screenshot_diff test.fixme is the sole exception)",
    applies: isSpec,
    test: (line) => /\btest\.(skip|only)\s*\(/.test(line),
  },
];

/** Strip line/block comments cheaply so lint does not fire on commented-out examples. */
function stripComments(line: string): string {
  const withoutLine = line.replace(/\/\/.*$/, "");
  return withoutLine.replace(/\/\*.*?\*\//g, "");
}

/**
 * Run the convention lint over generated files. Returns every violation
 * (never throws) — the caller logs them and records them in the manifest.
 */
export function lintGeneratedFiles(
  files: readonly { path: string; content: string }[],
): LintViolation[] {
  const violations: LintViolation[] = [];
  for (const file of files) {
    const applicable = LINT_RULES.filter((r) => r.applies(file.path));
    if (applicable.length === 0) {
      continue;
    }
    const lines = file.content.split("\n");
    lines.forEach((rawLine, index) => {
      // Keep `// qa-ai:allow-locator` visible to the raw-locator rule.
      const code = rawLine.includes("// qa-ai:allow-locator") ? rawLine : stripComments(rawLine);
      for (const rule of applicable) {
        if (rule.test(code)) {
          violations.push({
            file: file.path,
            line: index + 1,
            rule: rule.rule,
            message: rule.message,
          });
        }
      }
    });
  }
  return violations;
}
