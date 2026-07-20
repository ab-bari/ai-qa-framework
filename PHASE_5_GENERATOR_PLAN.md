# Phase 5 — Automation Script Generator (`qa-ai generate`)

> **Companion to [`qa-ai-automation-framework-PLAN.md`](qa-ai-automation-framework-PLAN.md) §6.4.**
> The master plan holds the authoritative contracts and the full phase sequence (0–8); this document is
> the detailed design for **Phase 5** and records the decisions that refine PLAN §6.4. The master plan has
> been reconciled to match every decision here — the two are kept in sync (see *Relationship to the master
> plan* at the end).
>
> Status: **approved, not yet implemented** — Phase 5 will be built in a later session.

## Context

The TypeScript framework in `qa-ai-automation-framework/` has completed Phases 0–4
(crawler → planner → executor + coverage + reporter). Phase 5 is the **generator**: turn a
machine-readable `TestPlan` (produced by our own Phase 3 planner) into a **self-contained, standalone
Playwright project** that follows the `automation/AGENTS.md` conventions and passes `npx playwright test`
on its own.

The old `automation/.claude/agents/playwright-test-*.md` sub-agents are **not** used at runtime.
`playwright-test-planner.md` is obsolete (our planner replaces it) and `playwright-test-generator.md`
is left as a reference only — generation is done programmatically by the framework via its LLM layer
(`completeJson`), not by an interactive Claude Code sub-agent. The `automation/` project is now a
**minimal clean baseline** — its example page objects and specs (`LoginPage.ts`, `InventoryPage.ts`,
`tests/auth/standard-login.spec.ts`) have been **deleted**. What remains is the golden contract set we
mirror into a new template scaffold: `AGENTS.md`, `src/fixtures/base.ts`, `src/pages/BasePage.ts`,
`tests/seed.spec.ts`, `tests/data/users.json`.

### Confirmed decisions (refine PLAN §6.4)
- **Mechanism:** programmatic `src/generator/` + `qa-ai generate` (per PLAN §6.4). The `.md` sub-agents
  are not used at runtime.
- **Output location:** `qa-ai-automation-framework/automation-tests/` — a top-level sibling of `.qa/`,
  **not** `.qa/generated-tests/`. Renamed everywhere: `generated-tests` → `automation-tests`.
- **Inputs:** `TestPlan` + `SiteModel` only. **No `RunResult` "healed truth" input** — build real
  Playwright locators from `SiteModel` `ElementModel` data (selector, role, accessible name, `data-test`,
  forms). No dependency on a prior `qa-ai execute` run.
- **Canonical plan input:** the TS framework's `.qa/plans/latest.json` (`--plan` overrides).
  `.qa-framework/latest_plan.json` is legacy Python output, not the source of truth.

## What we build

### 1. Template scaffold — `templates/generated-project/` (new; already in `package.json` `files`)
Copied to the output dir with trivial `{{token}}` substitution (no Handlebars dependency — a tiny
internal string replace in `scaffold.ts` covers `{{projectName}}` / `{{baseUrl}}`):
- `package.json.hbs` — pinned `@playwright/test`, `typescript`, `@types/node`; scripts `test`,
  `test:headed`, `report`. Name = `{{projectName}}`.
- `playwright.config.ts.hbs` — `testDir: "./tests"`, `reporter: [["html"],["json",{outputFile:"results.json"}]]`,
  `use.trace: "on-first-retry"`, `baseURL: "{{baseUrl}}"`, chromium project only.
- `tsconfig.json`, `.gitignore` (`node_modules/`, `test-results/`, `playwright-report/`, `.env`,
  `storage-state.json`), `README.md.hbs`.
- `src/fixtures/base.ts` — mirrors `automation/src/fixtures/base.ts` **plus** a `consoleErrors: string[]`
  fixture that collects only `[error]`-type console messages and filters network/CORS/favicon noise
  (mirrors the executor's `no_console_errors` logic — see `session_summary_phase_4.md` and
  `src/executor/assertions.ts`). Lets generated specs assert `expect(consoleErrors).toEqual([])` with no
  manual waits.
- `src/pages/BasePage.ts` — exact copy of `automation/src/pages/BasePage.ts` (abstract, `constructor(page)`,
  `abstract goto()`, `waitForReady()`).
- `tests/seed.spec.ts` — baseline smoke spec modeled on `automation/tests/seed.spec.ts`, parameterized on
  `{{baseUrl}}`.
- `.env.example` — generated per-run listing the credential env vars the specs read.

### 2. Generator modules — `src/generator/` (new)
Follows PLAN §3 file list:
- `conventions.ts` — the `automation/AGENTS.md` ruleset encoded as (a) a prompt block and (b) a set of
  regex lint checks. Includes the **assertion-type → Playwright mapping** table used by both the spec
  prompt and the lint (see §3 below).
- `prompts.ts` — builds the page-object and spec-generation prompts (system + user), embedding the
  conventions block and the condensed page/element data. Includes an **inline, self-authored worked
  example** (a small page object + spec constant, like the planner's embedded `WORKED_EXAMPLE`) shaped by
  `AGENTS.md` and the reference snippet in `automation/.claude/agents/playwright-test-generator.md` — it
  does **not** reference any deleted `automation/` file.
- `page-object-generator.ts` — one `completeJson` call **per targeted SiteModel page** (pages referenced
  by any test case's `target_page_id`). Input: `PageModel` elements (selector/role/name/text/attrs/forms).
  Output Zod-validated `{ files: [{ path, content }] }`. Locators built with the strict priority
  getByRole → getByLabel → getByPlaceholder → getByTestId (`data-test`/`data-testid`) → getByText;
  CSS/XPath forbidden.
- `spec-generator.ts` — one `completeJson` call **per feature group** (test cases grouped by
  `target_page_id`), given the generated page objects' public API. Emits
  `tests/<url-mirror>/<kebab>.spec.ts` + any non-credential `tests/data/*.json`. Credentials resolved from
  `{{auth_*}}` placeholders to `process.env` reads + `.env.example`. Each test carries a
  `// qa-ai:test_id=<id> signature=<coverage_signature>` traceability comment and appropriate tags.
- `scaffold.ts` — copy `templates/generated-project/` → output dir with token substitution; skip ephemeral
  dirs.
- `validate-loop.ts` — see §4.
- `index.ts` — orchestrates: resolve inputs → scaffold → generate POs → generate specs → validate → write
  manifest. Builds `RunContext` deps; uses `FakeLlmProvider` in tests.

### 3. Assertion-type → Playwright mapping (in `conventions.ts`, enforced by prompt + lint)
The `automation/` project has **no** assertion helpers — generated specs use inline web-first assertions.
The 14 `AssertionType`s map as:
- `element_visible` → `expect(loc).toBeVisible()`; `element_hidden` → `.toBeHidden()`
- `text_contains` → `.toContainText(v)`; `text_equals` → `.toHaveText(v)`; `text_matches` → `.toHaveText(/v/)`
- `url_matches` → `expect(page).toHaveURL(/v/)`; `page_title_contains` → `expect(page).toHaveTitle(/v/)`
- `element_count` → `.toHaveCount(n)`; `page_loaded` → `expect(page).toHaveURL(...)` + `BasePage.waitForReady()`
- `no_console_errors` → `expect(consoleErrors).toEqual([])` (via the base fixture)
- `network_request_made` / `response_status` → `page.waitForResponse(...)` predicate assertion
- `ai_evaluate` → the LLM translates the natural-language expectation into a **concrete** web-first
  assertion where feasible (e.g. "sorted Z→A" → read texts, assert ordering); when not feasible, emit a
  `test.step` with a `// qa-ai:ai_evaluate` TODO comment and **no fake-passing assertion**.
- `screenshot_diff` (and any visual-only case) → skipped in v1: emit as `test.fixme(...)` with a comment
  (the canonical TS plan is functional+security only, so this is a robustness path for the Python plan).

### 4. Validation loop — `validate-loop.ts`
Write files → `npm install` (in `automation-tests/`) → `npx tsc --noEmit` (feed errors back to the LLM,
max 3 repair rounds per file) → `npx playwright test --list` (catches import/fixture errors, same repair
loop) → static convention lint (regex: no `@playwright/test` import under `tests/`, no `waitForTimeout`/
`waitForSelector`, no raw CSS/XPath in locators) → emit `generation-manifest.json`. `--skip-validate`
bypasses the npm/tsc/list steps (lint still runs).

### 5. Manifest — `src/schemas/generation-manifest.ts` (new)
Zod schema (version already reserved in `src/schemas/versions.ts` as `generation-manifest: 1.0.0`):
`plan_id`, `site_model` ref, `target_url`, `project_dir`, `files: [{ path, kind: page-object|spec|data|scaffold,
test_ids: [] }]`, `repair_rounds`, envelope stamp. Written to `automation-tests/generation-manifest.json`
so it travels with the project (Phase 6 runner / Phase 7 healer consume it + the traceability comments).

## Files to create / modify (later implementation session)
Create:
- `templates/generated-project/**` (scaffold above).
- `src/generator/{index,scaffold,page-object-generator,spec-generator,validate-loop,conventions,prompts}.ts`.
- `src/schemas/generation-manifest.ts`.
- Unit tests under `tests/` mirroring the above.

Modify:
- `src/cli/commands/generate.ts` — implement the `.action()` (call `src/generator/index.ts`); **remove
  `--run-result`**; default `--output` = `automation-tests` (resolved as a sibling of the workspace root).
- `src/core/workspace.ts` — rename getter `generatedTestsDir` → `automationTestsDir`, returning
  `join(dirname(this.root), "automation-tests")` (i.e. `<framework/target root>/automation-tests`, outside
  `.qa/`). Keep `automationRunsDir` = `.qa/automation-runs` (Phase 6 reports unaffected).
- `qa-ai-automation-framework/.gitignore` — ignore `automation-tests/node_modules/`, `test-results/`,
  `playwright-report/`, `results.json`, `.env`.
- Framework `package.json` — no Handlebars dep (plain substitution); template pins live in `package.json.hbs`.

## Reference files (reuse / mirror — do not re-invent)
- Conventions: `automation/AGENTS.md` (+ the reference-style snippet inside
  `automation/.claude/agents/playwright-test-generator.md`). Base contracts to mirror into the template:
  `automation/src/fixtures/base.ts`, `automation/src/pages/BasePage.ts`, `automation/tests/seed.spec.ts`.
  Data-file pattern: `automation/tests/data/users.json`. (The former `LoginPage.ts`/`InventoryPage.ts`/
  `standard-login.spec.ts` were deleted — the generator's worked example is authored inline instead.)
- Schemas (inputs): `src/schemas/test-plan.ts` (9 actions, 14 assertions), `src/schemas/site-model.ts`
  (`PageModel`/`ElementModel`), `src/schemas/config.ts`.
- Infra to reuse: `src/core/{artifacts,workspace,run-context,ids}.ts`; `src/llm/{factory,json-mode,fake-provider}.ts`
  (`completeJson`); `src/cli/commands/plan.ts` (pattern for input discovery via `latest.json` pointer).
- `no_console_errors` filtering rationale: `session_summary_phase_4.md` + `src/executor/assertions.ts`.

## Verification (end-to-end)
1. `cd qa-ai-automation-framework` → `npm run dev -- generate` using existing artifacts
   (`.qa/plans/latest.json` + `.qa/site-model/site-model.json`). Confirm `automation-tests/` is created
   at the framework root (not under `.qa/`) with scaffold + POs + specs + `generation-manifest.json`.
2. `cd automation-tests && npm install && npx playwright test` → **passes standalone** (Phase 5 exit
   criterion). Spot-check AGENTS.md conformance (imports from `src/fixtures/base`, getByRole locators,
   tags, traceability comments, no `waitForTimeout`).
3. Unit tests (vitest, `FakeLlmProvider`): scaffold token substitution; conventions lint regex catches
   violations; assertion-mapping produces expected Playwright calls; `generation-manifest` schema
   round-trip. Integration: generate from a fixture plan+site-model → `npx tsc --noEmit` passes.
4. `npm run typecheck && npm run lint && npm run build && npm test` all clean.
5. After success: update memory (`qa-ai-automation-framework-plan.md`) with Phase 5 completion notes and
   the `automation-tests` / Plan+SiteModel decisions.

## Out of scope (v1)
No RunResult/healed-truth input, no visual/screenshot-diff generation (fixme'd), no multi-browser, no
sharding, no interactive `.md` sub-agent. Phases 6 (`run-generated`) and 7 (`heal`) remain future work.

## Relationship to the master plan
`qa-ai-automation-framework-PLAN.md` has been reconciled so no conflict remains with this document:
- §1 workflow diagram: `qa-ai generate → automation-tests/ … [reads TestPlan + SiteModel]`.
- §3 project structure + workspace layout: generated project lives at the framework/target root as
  `automation-tests/`, outside `.qa/`; `generation-manifest.ts` added to the schemas list; template
  scaffold notes `consoleErrors` fixture + `tests/seed.spec.ts`.
- §6.4: inputs = TestPlan + SiteModel (RunResult removed); output = `automation-tests/`; assertion-
  translation notes added; links here for detail.
- §6.5 / §6.6 / §7: default `--project` / `--output` = `automation-tests`; `--run-result` removed from
  the `qa-ai generate` row.
- §9 Phase 5 exit criterion updated to `cd automation-tests && npx playwright test`, with a link here.
