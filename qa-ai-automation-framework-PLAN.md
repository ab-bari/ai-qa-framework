# qa-ai-automation-framework — Build Plan

> **How to use this document:** This is a complete, self-contained build plan for a new TypeScript AI-driven QA framework. Hand it to a fresh Claude Code session in the `ai-qa-framework` repo and ask it to build the framework by following this plan phase by phase (Section 9). All reference files it needs from the current repo are listed in Section 12.

## 0. Context & Goal

The current repo contains a **Python** AI QA framework (`src/`): it crawls a website, uses an LLM to plan tests, executes them with Playwright (with self-healing), and reports with coverage tracking. The repo also contains a hand-built **TypeScript Playwright automation framework** (`automation/`) with a strict convention ruleset (`automation/AGENTS.md`).

**Goal:** build a new TypeScript framework in a new root folder **`qa-ai-automation-framework/`** (it will be moved to its own repository later — it must have zero references outside its own folder). It ports the Python pipeline AND adds Playwright test-script generation. Six independently-runnable components exchange artifacts:

**crawler → planner → manual-test-executor → automation-script-generator → automation-test-runner → automation-test-healer**

### Confirmed decisions

- **LLM access: Claude Pro/Max subscription via the locally installed Claude Code — NO API key.** The default provider uses the Claude Agent SDK (with a headless `claude -p` CLI fallback); both use local Claude Code subscription auth. The user starts/authorizes Claude Code on the machine before running components.
- The generator emits a **self-contained standalone Playwright project** following `automation/AGENTS.md` conventions.
- v1 carries over from the Python framework: **smart auth + storageState reuse** and **coverage registry + gap feedback**. v1 excludes: visual testing/screenshot diff, video-on-failure/flaky detection (schema hooks kept so they can be added later).
- Healer mode: **fix in place + re-run to verify**, with backups/diffs, restore-on-give-up, and an **HTML healing report**.
- The automation-test-runner's outputs are **Playwright's native HTML report** (human-facing) plus Playwright's **native JSON report file** as the machine handoff to the healer — no custom result-mapping layer.

## 1. Overview & Workflow

Six components, each a CLI subcommand, each independently runnable, communicating only via artifacts on disk:

```
qa-ai crawl          → .qa/site-model/site-model.json          (SiteModel)
qa-ai plan           → .qa/plans/plan-<ts>.json                (TestPlan)      [reads SiteModel + coverage gaps]
qa-ai execute        → .qa/runs/run-<ts>/run-result.json       (RunResult)     [reads TestPlan + SiteModel; updates coverage]
qa-ai generate       → automation-tests/  (repo root, not .qa/)  (standalone PW project) [reads TestPlan + SiteModel]
qa-ai run-generated  → Playwright's native HTML report (human) + native JSON report file (machine handoff)
qa-ai heal           → patched files + .qa/healing/session-<ts>/healing-report.html (+ .json) [reads Playwright JSON report + project]
```

Plus `qa-ai pipeline --from <step> --to <step>` to chain stages, and `qa-ai doctor` for environment checks.

## 2. Packaging Decision: single npm package (NOT a monorepo)

- All components share Zod schemas, the LLM provider, the Playwright version, and the config loader. A monorepo adds 7 package.jsons and build orchestration for zero benefit.
- "Independently runnable" is a CLI property; independence is guaranteed by the artifact-only communication rule.
- The generated test project is NOT a workspace package — it is emitted output with its own `package.json`.
- Enforce component isolation via lint rule: `src/<component>/**` may import only `src/core/**`, `src/llm/**`, `src/schemas/**` — never another component.

## 3. Project Structure

```
qa-ai-automation-framework/
├── package.json                    # bin: { "qa-ai": "./dist/cli/index.js" }
├── tsconfig.json                   # strict, NodeNext, ES2022, noUncheckedIndexedAccess
├── eslint.config.mjs               # typescript-eslint strictTypeChecked + import-boundaries
├── .prettierrc.json
├── vitest.config.ts
├── qa-config.example.json
├── README.md
├── src/
│   ├── cli/
│   │   ├── index.ts                # commander root
│   │   └── commands/               # crawl.ts, plan.ts, execute.ts, generate.ts,
│   │                               # run-generated.ts, heal.ts, pipeline.ts, doctor.ts
│   ├── core/                       # shared infra — the ONLY cross-component import target
│   │   ├── config/                 # loadConfig.ts (Zod), env: prefix resolution for secrets
│   │   ├── workspace.ts            # .qa/ path resolution, latest.json pointer discovery
│   │   ├── artifacts.ts            # readArtifact<T>(schema, path) / writeArtifact (schema_version stamp)
│   │   ├── logger.ts               # leveled console + file logger
│   │   ├── errors.ts               # QaError hierarchy: ConfigError, ArtifactError, LlmError, BrowserError
│   │   ├── browser/                # launchStealthBrowser.ts, contextFactory.ts (storageState injection)
│   │   ├── auth/                   # authenticator.ts (smart auth), sessionGuard.ts (invalidation + re-auth lock)
│   │   └── ids.ts                  # md5 element ids, page_id from URL, run/plan id generation
│   ├── llm/
│   │   ├── types.ts                # LLMProvider interface
│   │   ├── claude-code-provider.ts # DEFAULT: Claude Agent SDK (subscription auth)
│   │   ├── claude-cli-provider.ts  # fallback: spawn `claude -p`, prompt via stdin
│   │   ├── json-mode.ts            # extract → Zod parse → one schema-guided repair round-trip
│   │   ├── retry.ts                # exponential backoff, transient-error classification
│   │   └── debug-log.ts            # every exchange → .qa/debug/ai/<ts>-<purpose>/
│   ├── schemas/                    # Zod schemas + inferred types
│   │   ├── config.ts  site-model.ts  test-plan.ts  run-result.ts
│   │   ├── coverage.ts  pw-json-report.ts  healing-report.ts  generation-manifest.ts
│   │   └── versions.ts             # SCHEMA_VERSIONS map
│   ├── crawler/
│   │   ├── index.ts  frontier.ts  page-analyzer.ts  link-discovery.ts
│   │   ├── network-capture.ts  auth-probe.ts
│   ├── planner/
│   │   ├── index.ts  site-summarizer.ts  prompts.ts  plan-validator.ts  fallback-planner.ts
│   ├── executor/
│   │   ├── index.ts  test-runner.ts  action-runner.ts  assertions.ts
│   │   ├── selector-resolver.ts  llm-fallback.ts  evidence.ts
│   ├── coverage/
│   │   ├── registry.ts  scorer.ts  gap-analyzer.ts
│   ├── reporter/
│   │   ├── html-report.ts  json-report.ts  regression-detector.ts  ai-summary.ts
│   ├── generator/
│   │   ├── index.ts  scaffold.ts  page-object-generator.ts  spec-generator.ts
│   │   ├── validate-loop.ts  conventions.ts
│   ├── automation-runner/
│   │   ├── index.ts                # spawn playwright test with html+json reporters; no custom mapping
│   └── healer/
│       ├── index.ts  triage.ts  context-builder.ts  patcher.ts  verify-loop.ts
│       ├── pw-report-reader.ts     # parse Playwright's native JSON report + traceability comments
│       └── report.ts               # healing-report.html (primary) + healing-report.json
├── templates/generated-project/    # static scaffold copied verbatim by generator → automation-tests/
│   ├── package.json.hbs            # {{projectName}} substitution only
│   ├── playwright.config.ts.hbs    # {{baseUrl}}; html + json reporters, trace on-first-retry, chromium
│   ├── tsconfig.json
│   ├── .gitignore                  # storage-state.json, test-results/, .env
│   ├── src/fixtures/base.ts        # mirrors automation/ base + consoleErrors fixture (no_console_errors)
│   ├── src/pages/BasePage.ts       # mirrors automation/src/pages/BasePage.ts contract
│   ├── tests/seed.spec.ts          # baseline smoke, parameterized on {{baseUrl}}
│   └── README.md.hbs
└── tests/                          # framework's own vitest unit tests, mirrors src/
```

### Workspace layout (`.qa/`, configurable via `workspace_dir`)

```
.qa/
├── site-model/site-model.json + pages/<page_id>/{screenshot.png, dom.html}
├── plans/plan-<ts>.json + latest.json         # pointer: { "path": "plans/plan-…json" }
├── runs/run-<ts>/{run-result.json, evidence/<test_id>/*, report/{report.html, report.json}}
├── coverage/coverage-registry.json
├── auth/storage-state.json                    # gitignored
├── automation-runs/run-<ts>/{playwright-report/ (native HTML), results.json (native PW JSON)}
├── healing/session-<ts>/{healing-report.html, healing-report.json, backups/, diffs/}
└── debug/ai/<ts>-<purpose>/{prompt.md, response.md, meta.json}
```

> **Note:** the generated Playwright project is emitted **outside** `.qa/`, at the framework/target root as `automation-tests/` (own `package.json`, repo-extraction-ready). `.qa/automation-runs/` still holds the Phase 6 run reports. Detailed design: [`PHASE_5_GENERATOR_PLAN.md`](PHASE_5_GENERATOR_PLAN.md).

## 4. Data Contracts (Zod)

Artifact JSON keeps the **Python snake_case field names** (port field-for-field from `src/models/*.py` in the old repo) for familiarity and cross-compatibility. Every top-level artifact gets `schema_version: string` and `generated_by: string`. `readArtifact` rejects major-version mismatches with a clear error.

| File | Schemas |
|---|---|
| `schemas/config.ts` | `ViewportConfig`, `CrawlConfig` (target_url, max_pages, max_depth, include_patterns, exclude_patterns, wait_for_idle, viewport, user_agent), `AuthConfig` (login_url, username, password w/ `env:` resolution, username_selector/password_selector/submit_selector, success_indicator, auto_detect, llm_fallback), `FrameworkConfig` (target_url, auth, crawl, categories, max_tests_per_run, max_execution_time_seconds, max_parallel_contexts, selector_timeout_seconds, ai_provider `"claude-code" \| "claude-code-cli"` (reserve `"anthropic-api"`, `"ollama"`), ai_model, ai_max_fallback_calls_per_test, staleness_threshold_days, history_retention_runs, hints, workspace_dir) |
| `schemas/site-model.ts` | `ElementModel` (element_id, tag, selector, role, text_content, is_interactive, element_type, attributes), `FormField`, `FormModel`, `NetworkRequest`, `APIEndpoint`, `AuthFlow`, `PageModel` (page_id, url, page_type, title, elements, forms, network_requests, screenshot_path, dom_snapshot_path, auth_required), `SiteModel` (base_url, pages, navigation_graph, api_endpoints, auth_flow, crawl_metadata) |
| `schemas/test-plan.ts` | `Action` (action_type: navigate\|click\|fill\|select\|hover\|scroll\|wait\|screenshot\|keyboard; selector, value, description), `Assertion` (assertion_type — 14 types, selector, expected_value, tolerance, description), `TestCase` (test_id, name, description, category functional\|security (visual reserved), priority 1–5, target_page_id, coverage_signature, requires_auth, preconditions, steps, assertions, timeout_seconds), `TestPlan` (plan_id, generated_at, target_url, test_cases, estimated_duration_seconds, coverage_intent) |
| `schemas/run-result.ts` | `Evidence`, `FallbackRecord` (step_index, original_selector, decision, new_selector, reasoning), `StepResult`, `AssertionResult`, `TestResult` (…, actual_page_id, actual_url, coverage_signature), `RunResult` (run_id, plan_id, started_at, completed_at, target_url, counts, test_results, ai_summary) |
| `schemas/coverage.ts` | `SignatureRecord`, `CategoryCoverage`, `PageCoverage`, `GlobalCoverageStats`, `CoverageGapReport` (untested_pages, stale_pages, low_coverage_areas, recent_failures, suggested_focus), `CoverageRegistry` |
| `schemas/pw-json-report.ts` | **New.** Minimal Zod schema for the parts of Playwright's NATIVE JSON reporter output the healer consumes (suites → specs → tests → results: title, file, status, errors, retries). No custom AutomationRunResult artifact — the runner stage's outputs are Playwright's own HTML report (human) and JSON report file (machine handoff). |
| `schemas/healing-report.ts` | **New.** `FailureTriage` (test_ref, classification locator\|assertion\|navigation\|data\|app_bug\|environment, healable, reasoning), `PatchRecord` (file_path, backup_path, diff_path, diff_unified, attempt, description), `HealAttempt` (attempt_no, patches, verify_status, verify_error), `HealedTest` (source_test_id, spec_file, test_title, triage, attempts, final_status healed\|unhealable\|gave_up\|app_bug_suspected), `HealingReport` (session_id, automation_run_path, started_at, completed_at, tests_considered, tests_healed, tests_unhealable, healed_tests, summary). Rendered as **healing-report.html** (self-contained: summary stats, per-test cards with triage, attempts, embedded diffs) plus healing-report.json for programmatic use. |

**Artifact discovery:** explicit `--input <path>` flag → `latest.json` pointer → error naming the prerequisite command (`No test plan found. Run 'qa-ai plan' or pass --input.`). Writers update `latest.json` atomically (temp + rename).

## 5. LLM Integration (Claude subscription, no API key)

**Default provider: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)**, which drives the locally-installed, subscription-authenticated Claude Code. **Fallback provider: `claude-cli-provider`** spawning `claude -p --output-format json --model <m>` with the **prompt piped via stdin** (never argv — Windows ~32K argv limit and quoting issues; planner prompts are 10–50 KB).

**Vision** (ai_evaluate, auth detection, fallback healing, healer live-DOM): write the screenshot to a known absolute path, reference the path in the prompt ("Read and examine the screenshot at <path>"), and allow ONLY the `Read` tool (`allowedTools: ["Read"]` in SDK, `--allowedTools Read` in CLI).

```ts
export interface LlmRequest {
  purpose: string;              // "planner" | "selector-fallback" | "healer-patch" | … (drives debug log + timeout profile)
  prompt: string;
  system?: string;
  imagePaths?: string[];        // absolute paths
  model?: "default" | "fast";   // mapped per-provider
  timeoutMs?: number;
}
export interface LlmResponse { text: string; durationMs: number; raw?: unknown; }

export interface LLMProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
  completeJson<T>(req: LlmRequest, schema: z.ZodType<T>): Promise<T>;
  healthCheck(): Promise<{ ok: boolean; detail: string }>;   // used by `qa-ai doctor`
}
```

- Provider chosen ONCE in a `createProvider(config)` factory. **Zero `if (provider === …)` branching elsewhere** (fixes the Python leaky-abstraction weakness).
- `completeJson` pipeline: append "Respond with ONLY a JSON object in a ```json fence matching this schema: <zod-to-json-schema>" → extract last fenced block or largest balanced `{…}` → detect truncation (retryable) → `safeParse` → on failure ONE schema-guided repair round-trip (send invalid JSON + Zod error paths back) → still failing → `LlmJsonError` (callers fall back deterministically).
- Retry: max 3 attempts, backoff 2s/8s/30s + jitter, on spawn failure/transient stderr/timeout/truncation. NEVER retry auth errors — fail fast with "run `claude login`" remediation (`qa-ai doctor` checks this).
- Timeout profiles: planner/generator 300s, fallback/judge 90s, summary 120s.
- Debug logging: every exchange → `.qa/debug/ai/<ts>-<purpose>/{prompt.md, response.md, meta.json}`.

## 6. Component Designs

### 6.1 crawler (`qa-ai crawl`)
- Priority-queue BFS frontier (binary heap keyed `(priority, depth, seq)`): START=0, ORGANIC=10, INTERACTIVE=20, SITEMAP=50; visited-set on normalized URLs; same-origin + include/exclude regex.
- Per page: goto (+ optional networkidle) → page-type classification heuristics (form-density, listing/detail, URL keywords) → element extraction via one `page.evaluate` sweep (tag, role, name, text, attrs, stable selector guess; `element_id = md5(page_id + selector + tag)`) → form analysis → screenshot + `page.content()` snapshot → network capture (dedupe into APIEndpoint).
- Link discovery, 4 strategies + sitemap backfill: static anchors; SPA routes; dynamic attrs (`data-href`, `onclick` URLs); interactive clicking of nav toggles in a sacrificial context.
- Auth-aware: if `config.auth` set, authenticate FIRST (auto-detect selectors; LLM vision fallback), save `.qa/auth/storage-state.json`, crawl authenticated; probe each page in a clean context → `auth_required` true/false.
- Stealth browser flags (hide `navigator.webdriver`, etc.).
- Per-page failures → `crawl_metadata.errors[]`, never fatal; fatal only if start URL unreachable.
- AI touchpoint: only optional login-form detection.

### 6.2 planner (`qa-ai plan`)
- Inputs: SiteModel + CoverageRegistry (gap report computed by `gap-analyzer.ts`; empty registry OK) + config (categories, max_tests_per_run, hints).
- `site-summarizer.ts`: CONDENSED summary — never raw SiteModel JSON. First 30 pages (prioritize gap-report `suggested_focus`, then page-type diversity), ≤20 elements/page (interactive first), forms fully, auth flow, top API endpoints.
- Single `completeJson` call with `TestPlanSchema`: summary + gap report + category budget (~60/40 functional/security in v1; configurable) + hints + one worked example test case.
- Credentials: plan on disk stays credential-free with `{{auth_username}}`/`{{auth_password}}` placeholders (resolved by executor); `{{$timestamp}}` resolved at execution time.
- `plan-validator.ts`: per-test-case `safeParse`, drop invalid ones individually with logs; derive `coverage_signature = category + ":" + target_page_id + ":" + slug(name)` when missing.
- `fallback-planner.ts`: deterministic plan if LLM fails (per page: load+title assert, one form fill/submit, one nav click); flags `coverage_intent.fallback = true`.

### 6.3 manual-test-executor (`qa-ai execute`)
- Scheduler: priority sort asc → semaphore (`max_parallel_contexts`, default 3) → wall-clock budget (`max_execution_time_seconds`); not-started tests marked `skip`.
- Per-test fully isolated BrowserContext; shared single browser.
- Auth: authenticate once → storageState injected into `requires_auth` contexts; `sessionGuard.ts` detects invalidation (login redirect / missing success_indicator) → single-flight re-auth under async mutex → retry step once.
- Action runner: the 9 action types; per-step screenshot into evidence.
- **Two-tier self-healing:**
  1. `selector-resolver.ts` — deterministic: derive alternatives from SiteModel ElementModel attributes using REAL Playwright locators (`getByRole`, `getByLabel`, `getByPlaceholder`, `getByTestId`, `getByText`, relaxed CSS last). Never splice selector strings.
  2. `llm-fallback.ts` — screenshot + trimmed DOM around failure + console errors → Zod-validated `{decision: retry|adapt|skip|abort, new_selector?, reasoning}` → recorded as FallbackRecord; budget `ai_max_fallback_calls_per_test = 3`.
- Assertions: 14 types (element_visible/hidden, text_contains/equals/matches, url_matches, element_count, network_request_made, no_console_errors, response_status, page_title_contains, page_loaded, ai_evaluate, screenshot_diff). `ai_evaluate` = vision judge → `{verdict, confidence, reasoning}`, pass iff verdict && confidence ≥ 0.7. `screenshot_diff` stubs to `skipped` in v1 (enum member kept).
- After run: record `actual_page_id`/`actual_url` from final browser URL → update coverage registry attributed to actual_page_id → reporter emits HTML (self-contained, base64 screenshots, per-test expandable cards) + JSON, regression detection by coverage_signature vs previous run, AI summary with template fallback.

### 6.4 automation-script-generator (`qa-ai generate`)
> Detailed design: [`PHASE_5_GENERATOR_PLAN.md`](PHASE_5_GENERATOR_PLAN.md).
- Inputs: **TestPlan + SiteModel** (canonical TestPlan = the TS framework's `.qa/plans/latest.json`; `--plan` overrides; `.qa-framework/latest_plan.json` is legacy Python output). Real Playwright locators are derived from `SiteModel` `ElementModel` data (selector, role, accessible name, `data-test`, forms) — not from a prior run.
- **Output:** self-contained standalone project emitted at the framework/target root as **`automation-tests/`** (NOT inside `.qa/`; own `package.json`, repo-extraction-ready).
- **Deterministic scaffold** (copied from `templates/generated-project/`, no LLM): package.json (pinned `@playwright/test`, `typescript`; scripts test/test:headed/report), tsconfig, playwright.config.ts (testDir `./tests`, `reporter: [["html"],["json",{outputFile:"results.json"}]]`, trace on-first-retry, chromium, baseURL injected), `src/fixtures/base.ts` (mirrors `automation/` base + a `consoleErrors` fixture backing `no_console_errors`), `src/pages/BasePage.ts` (exact `automation/` contract), `tests/seed.spec.ts` (baseline smoke), .gitignore, README.
- **LLM-generated content:**
  1. Page objects — one call per targeted SiteModel page: PageModel elements + conventions block → `{ files: [{path, content}] }` Zod-validated.
  2. Specs + data — one call per feature group (test cases grouped by target_page_id): TestCases + generated page-object public API signatures → `tests/<url-mirror>/<kebab>.spec.ts` + `tests/data/*.json`. Credentials emitted as `process.env` reads + `.env.example` (never committed values).
- **Assertion translation** (14 types → web-first Playwright): direct maps for element_visible/hidden, text_contains/equals/matches, url_matches, element_count, page_title_contains, page_loaded; `no_console_errors` via the `consoleErrors` fixture; network_request_made/response_status via `page.waitForResponse`; `ai_evaluate` → a concrete assertion when feasible else a `// qa-ai:ai_evaluate` TODO (never a fake pass); `screenshot_diff`/visual-only → `test.fixme` (v1 excludes visual).
- **Conventions enforced** (`conventions.ts` — from `automation/AGENTS.md`): import test/expect from `src/fixtures/base` only; PO contract (extends BasePage, constructor(page) only, readonly locators in constructor, no expect() in POs, actions return void or next PO); locator priority getByRole → getByLabel → getByTestId → getByText, **CSS/XPath forbidden**; web-first assertions; `waitForTimeout`/`waitForSelector` banned; test.describe per feature; tags in titles (@smoke @regression @critical); test.step for >3 actions; kebab-case specs mirroring URL structure; `// qa-ai:test_id=TC-001 signature=<coverage_signature>` traceability comment per test.
- **Validation loop** (`validate-loop.ts`): write files → `npm install` → `npx tsc --noEmit` (errors fed back to LLM, max 3 repair rounds per file) → `npx playwright test --list` (catches import/fixture errors, same loop) → static convention lint (regex: no `@playwright/test` import in tests/, no waitForTimeout, no raw CSS locators in specs) → emit `generation-manifest.json` (plan_id, file→test_id map, repair rounds) for runner/healer.

### 6.5 automation-test-runner (`qa-ai run-generated`)
- Operates on the generated `automation-tests/` project by default (`--project` overrides). Verify package.json → `npm install` if node_modules missing (`--install` to force) → ensure chromium installed → spawn `npx playwright test` with html+json reporters, output paths pointed into `.qa/automation-runs/run-<ts>/` → print console summary + path to the **Playwright HTML report** (the stage's human-facing output — no custom report layer). The native Playwright **JSON report file** (`results.json`) is kept alongside as the machine handoff the healer consumes directly. No remapping/custom schema. Pass-through flags: `--grep`, `--spec`, `--headed`, `--workers`. No AI. Exit code mirrors Playwright; reports always written.

### 6.6 automation-test-healer (`qa-ai heal`)
- **Triage** (deterministic, from error text/stack):

| Classification | Signals | Healable? |
|---|---|---|
| locator | locator timeout, strict mode violation, not visible/attached | Yes |
| assertion | expect timeout / text mismatch | Cautiously — only if live DOM shows intent still satisfiable. NEVER weaken assertions. |
| navigation | goto timeout, redirect/URL changes | Yes |
| data | login rejected, validation errors from stale data | Yes (update tests/data JSON) |
| app_bug | 500s, console exceptions, mismatch confirmed against live DOM | **No — report app_bug_suspected, never patch** |
| environment | browser launch failure, ECONNREFUSED | No — report with remediation |

- **Input:** Playwright's native JSON report (`pw-report-reader.ts` parses it with a minimal Zod schema and resolves `source_test_id` from the `// qa-ai:test_id=…` traceability comments + generation-manifest).
- **Context assembly:** error + stack + snippet from PW JSON report; full spec source + imported page objects (import graph via generation-manifest); **live DOM**: re-navigate fresh context (reuse storage-state if auth needed) → screenshot + trimmed page.content(); `--no-live-dom` uses trace snapshot instead.
- **Patch → verify loop:** `completeJson` with schema `{ analysis, root_cause, patches: [{file_path, new_content, description}] }` + hard rules (minimum-viable fix, locator priority, no waitForTimeout, never skip/comment out tests, never weaken assertion intent) → backup to `healing/session-<ts>/backups/<relpath>.attempt-N` → write → unified diff recorded → verify with `npx playwright test <spec> -g "<title>" --reporter=json` → pass = `healed`; fail = next attempt with new error appended; max `--max-attempts` (default 3) → on exhaustion **restore all backups** (never leave half-healed state), mark `gave_up`.
- Group failures by shared page object; heal one representative first, re-run group (one root-cause fix heals many).
- Optional `--verify-suite` full re-run to catch cross-test regressions; then write **healing-report.html** (self-contained: summary stats, per-test cards with triage classification, attempt timeline, embedded unified diffs, final status badges) plus healing-report.json, and print a console summary table.

## 7. CLI Reference

Global flags: `--config <path>` (default `./qa-config.json`), `--workspace <dir>`, `--verbose`.

| Command | Key flags | Example |
|---|---|---|
| `qa-ai crawl` | `--max-pages`, `--output` | `qa-ai crawl --max-pages 15` |
| `qa-ai plan` | `--site-model`, `--coverage`, `--max-tests`, `--output` | `qa-ai plan --max-tests 20` |
| `qa-ai execute` | `--plan`, `--site-model`, `--headed`, `--max-parallel`, `--filter` | `qa-ai execute --headed` |
| `qa-ai generate` | `--plan`, `--site-model`, `--output`, `--skip-validate` | `qa-ai generate` (→ `automation-tests/`) |
| `qa-ai run-generated` | `--project`, `--grep`, `--headed`, `--install` | `qa-ai run-generated` |
| `qa-ai heal` | `--run`, `--project`, `--max-attempts`, `--test`, `--no-live-dom`, `--verify-suite` | `qa-ai heal --max-attempts 3` |
| `qa-ai pipeline` | `--from <step> --to <step>` | `qa-ai pipeline --from crawl --to execute` |
| `qa-ai doctor` | `--validate-artifacts` | checks Node ≥20, claude CLI on PATH + authed, Playwright browsers, config validity |

Default generated-project path for `run-generated` / `heal` is `automation-tests/` (`--project` overrides).

Exit codes: 0 ok; 1 component error; 2 config/input error; 3 tests-failed (execute / run-generated).

## 8. Coding Standards (the framework itself)

- tsconfig: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, NodeNext, ES2022. Build to `dist/`.
- typescript-eslint strictTypeChecked; `no-explicit-any` (use `unknown` + Zod narrowing at IO boundaries); `no-floating-promises`; import-boundary rule (components → core/llm/schemas only). Prettier, 100 cols.
- Errors: typed `QaError` subclasses with `code` + `remediation`; components' entry points are the only try/catch tier; CLI prints `code: message → remediation` (stack only with `--verbose`).
- No module-level mutable state. Each command builds `RunContext { config, workspace, logger, llm }` and passes it down explicitly.
- Naming: kebab-case files, PascalCase classes, `XxxSchema` + `type Xxx = z.infer<>`; artifact JSON keys snake_case; TS locals camelCase.
- Async: no fire-and-forget; semaphore for concurrency; `AbortSignal` threading for budgets.
- Unit tests: vitest, `tests/` mirroring `src/`; `FakeLlmProvider` with canned responses as first-class test utility; browser-touching integration tests separated (`npm run test:integration`).

## 9. Phased Build Order (TO-DOs)

- **Phase 0 — Skeleton** (exit: `qa-ai doctor` runs): package init, tsconfig/eslint/prettier/vitest, commander CLI shell with stubbed subcommands, config loader + `env:` resolution, workspace + artifacts helpers, ALL Zod schemas (field-for-field port from Python `src/models/*.py`) with round-trip unit tests, logger + error hierarchy.
- **Phase 1 — LLM layer** (exit: doctor full AI check + hidden `qa-ai ai-echo` debug command): LLMProvider interface, ClaudeCodeProvider (Agent SDK), CLI fallback provider, json-mode, retry, debug-log. Manual verify: JSON round-trip + screenshot-describe against real local Claude Code.
- **Phase 2 — Crawler** (exit: `qa-ai crawl` vs saucedemo.com): stealth browser, frontier, page analyzer, link strategies + sitemap, network capture, smart auth + storage-state, clean-context auth probing. Verify site-model has login/inventory/cart pages, correct `auth_required`, `data-test` attrs captured.
- **Phase 3 — Planner + coverage read path** (exit: `qa-ai plan`): summarizer, prompts, plan-validator, fallback planner, gap-analyzer on empty registry. Verify valid TestPlan; forced-LLM-failure yields fallback plan.
- **Phase 4 — Executor + coverage write + reporter** (exit: full crawl→plan→execute loop green on saucedemo): scheduler, action runner, 14 assertions, tier-1/2 healing, session guard, evidence, coverage update, HTML/JSON reports, regression detection. Verify healing fires on a deliberately wrong selector; second plan run reflects gap feedback.
- **Phase 5 — Generator** (exit: `qa-ai generate` then `cd automation-tests && npx playwright test` passes standalone): templates, scaffold, PO generator, spec generator, conventions, tsc + `--list` validation loop, manifest. Inputs = TestPlan + SiteModel; output = top-level `automation-tests/`. Detailed design: [`PHASE_5_GENERATOR_PLAN.md`](PHASE_5_GENERATOR_PLAN.md). Spot-check AGENTS.md conformance.
- **Phase 6 — Automation runner** (exit: `qa-ai run-generated`): install/browser checks + spawn with html+json reporters into the run folder + console summary pointing at the Playwright HTML report. Verify HTML report opens and results.json is valid.
- **Phase 7 — Healer** (exit: `qa-ai heal` drills pass): pw-report-reader, triage, context builder, patcher w/ backup+diff, verify loop, restore-on-give-up, HTML+JSON healing report. Drills: sabotaged locator → healed green; wrong-text assertion → cautious triage; genuine missing element → app_bug_suspected with NO patch.
- **Phase 8 — Pipeline + polish**: `qa-ai pipeline`, README with six-command workflow, qa-config.example.json, end-to-end smoke script, verify zero references outside the folder (repo-extraction ready).

## 10. NOT-To-Dos

**v1 exclusions** (keep cheap schema hooks — reserved enum members/nullable fields — so they bolt on later): visual testing/screenshot diff; video-on-failure & flaky detection (`potentially_flaky` field exists, always false); multi-browser/multi-viewport (chromium desktop only); OAuth/SSO/MFA (form auth only); CI/GitHub Actions setup; Allure; sharding of generated tests; API-key providers (interface only); accessibility audits; mobile emulation; watch/daemon mode.

**Anti-patterns to avoid** (lessons from the Python codebase):
- Leaky provider branching — factory-only provider selection.
- Regex JSON "repair" as primary strategy — schema-guided repair round-trip is primary.
- String-surgery selector healing — build real Playwright Locator alternatives from ElementModel data.
- Global mutable state / module singletons — everything through RunContext.
- Components importing each other — artifacts are the ONLY inter-component API.
- Prompting with raw full SiteModel JSON — condensed summaries with explicit budgets.
- Silent skips/drops — every skip/drop/heal decision lands in an artifact field.
- Generated code violating AGENTS.md — enforced by validation-loop lint, not just prompts.
- Passing large prompts via argv on Windows — always stdin/SDK.

## 11. Verification Strategy

- **Reference target: https://www.saucedemo.com** (matches existing `automation/` tests; `standard_user`/`secret_sauce`; has `data-test` attributes; `locked_out_user` for error paths).
- **Unit (vitest, no network/LLM):** schema round-trips against fixture JSON; frontier ordering; URL normalization/page_id; json-mode extraction/truncation on canned malformed responses; triage table vs corpus of real Playwright error strings; selector-resolver derivation from ElementModel fixtures; pw-report-reader vs a saved native Playwright JSON report; healing-report HTML rendering from a fixture HealingReport; patcher backup/restore on temp dirs.
- **Integration (`test:integration`, real browser, FakeLlmProvider default / real provider behind `QA_AI_LIVE=1`):** crawl saucedemo max_pages=5 → assert model shape; execute a hand-written 3-test plan; generate from fixture artifacts → `tsc --noEmit` passes.
- **Healing drill:** `scripts/heal-drill.ts` — copy generated project to temp, sabotage a locator, run heal, assert green + report contents.
- **E2E smoke:** `npm run smoke` → `qa-ai pipeline --from crawl --to heal` on saucedemo (max_pages=8, max_tests=10); assert every artifact exists + Zod-validates, generated suite passes, healing report clean.

## 12. Reference files in the CURRENT repo (read these when building)

- `src/models/config.py`, `site_model.py`, `test_plan.py`, `test_result.py`, `coverage.py` — canonical field names for the Zod port
- `automation/AGENTS.md` — generated-project conventions to encode in `src/generator/conventions.ts`
- `automation/src/pages/BasePage.ts`, `automation/src/fixtures/base.ts`, `automation/tests/seed.spec.ts` — exact contracts for `templates/generated-project/`
- `src/crawler/`, `src/executor/`, `src/planner/`, `src/coverage/` (Python) — algorithm references
- `src/ai/prompts/*.py` — prompt starting points (planning, evaluation, fallback, auth, summary)
- `qa-config.json.example` — config shape reference
