# qa-ai-automation-framework

AI-driven QA automation framework in TypeScript. Six independently-runnable components exchange
artifacts on disk — no component imports another:

```
qa-ai crawl          → .qa/site-model/site-model.json          (SiteModel)
qa-ai plan           → .qa/plans/plan-<ts>.json                (TestPlan)
qa-ai execute        → .qa/runs/run-<ts>/run-result.json       (RunResult)
qa-ai generate       → automation-tests/                       (standalone Playwright project)
qa-ai run-generated  → Playwright native HTML report + results.json
qa-ai heal           → patched files + .qa/healing/session-<ts>/healing-report.html
```

Plus `qa-ai pipeline --from <step> --to <step>` to chain stages and `qa-ai doctor` for
environment checks.

**LLM access:** your Claude Pro/Max subscription via the locally installed Claude Code — no API
key. Install Claude Code and run `claude login` once before using AI-powered commands.

## Getting started

```bash
npm install
npm run build

# Check your environment
node dist/cli/index.js doctor

# Configure
cp qa-config.example.json qa-config.json   # then edit target_url / auth
```

During development, run the CLI without building: `npm run dev -- doctor`.

## Build status

| Phase | Scope                                                                                  | Status  |
| ----- | -------------------------------------------------------------------------------------- | ------- |
| 0     | Skeleton: CLI shell, config loader, workspace/artifacts, all Zod schemas, doctor       | ✅ done |
| 1     | LLM layer (Claude Agent SDK + `claude -p` fallback), json-mode, retry, doctor AI check | ✅ done |
| 2     | Crawler                                                                                | ✅ done |
| 3     | Planner + coverage read path                                                           | ✅ done |
| 4     | Executor + coverage write + reporter                                                   | ✅ done |
| 5     | Generator (standalone Playwright project)                                              | ✅ done |
| 6     | Automation runner                                                                      | ✅ done |
| 7     | Healer                                                                                 | ⬜      |
| 8     | Pipeline + polish                                                                      | ⬜      |

`crawl`, `plan`, `execute`, `generate` and `run-generated` are usable today; `heal` is still a
stub.

## Usage

The implemented stages chain through `.qa/`, each picking up the previous stage's output
via its `latest.json` pointer (the generator additionally emits a project outside `.qa/`):

```bash
node dist/cli/index.js crawl --max-pages 8      # → .qa/site-model/site-model.json
node dist/cli/index.js plan  --max-tests 15     # → .qa/plans/plan-<ts>.json
node dist/cli/index.js execute --max-parallel 2 # → .qa/runs/run-<ts>/
node dist/cli/index.js generate                 # → automation-tests/ (standalone project)
```

Add `--config qa-config.json` if your config is not at the default `./qa-config.json`, and
`--verbose` for debug logging.

**`crawl`** — priority-queue BFS with stealth Chromium, four link-discovery strategies plus
sitemap backfill, smart auth (explicit selectors → heuristic auto-detect → LLM vision), and
clean-context probing to mark each page's `auth_required`.

**`plan`** — condenses the SiteModel (never raw JSON) plus a coverage gap report into one
LLM call, validates each test case individually so one malformed case cannot sink the plan, and
falls back to a deterministic plan on any LLM failure. Credentials stay on disk as
`{{auth_username}}` / `{{auth_password}}` placeholders.

**`execute`** — runs the plan against the live site and writes:

| Output                                  | What it is                                          |
| --------------------------------------- | --------------------------------------------------- |
| `.qa/runs/run-<ts>/run-result.json`     | the RunResult artifact (the machine handoff)        |
| `.qa/runs/run-<ts>/report/report.html`  | self-contained HTML report, screenshots embedded    |
| `.qa/runs/run-<ts>/report/report.json`  | the same run plus detected regressions              |
| `.qa/runs/run-<ts>/evidence/<test_id>/` | screenshots, console log, network log, DOM snapshot |
| `.qa/coverage/coverage-registry.json`   | coverage feedback the next `plan` run consumes      |

Key flags: `--plan`, `--site-model`, `--coverage`, `--headed`, `--max-parallel`, `--filter`.

Tests run in isolated browser contexts, bounded by `max_parallel_contexts` and a wall-clock
budget (`max_execution_time_seconds`); tests that never start are recorded as `skip` rather than
dropped. A failing step recovers in three escalating stages — deterministic selector healing from
SiteModel element data, session re-authentication and one retry, then a budgeted AI fallback —
and every recovery decision is recorded in the artifact.

Exit codes: `0` ok, `1` component error, `2` config/input error, `3` tests failed.

**`generate`** — turns the TestPlan + SiteModel into a **self-contained standalone Playwright
project** at `automation-tests/` (a sibling of `.qa/`, with its own `package.json` so it can be
committed and extracted to its own repo). Real Playwright locators are derived from the SiteModel's
element data — never from a prior run.

| Output                                      | What it is                                                      |
| ------------------------------------------- | --------------------------------------------------------------- |
| `automation-tests/src/pages/*.ts`           | Page Objects (one per targeted page), extending `BasePage`      |
| `automation-tests/tests/**/*.spec.ts`       | specs mirroring the app URL structure, with traceability tags   |
| `automation-tests/tests/data/*.json`        | non-credential test data                                        |
| `automation-tests/.env.example`             | the credential env vars the specs read (values never committed) |
| `automation-tests/generation-manifest.json` | maps each file back to its source TestCase ids                  |

A deterministic scaffold (`package.json`, `playwright.config.ts` with HTML + JSON reporters,
`src/fixtures/base.ts` with a `consoleErrors` fixture, `BasePage`, seed spec) is copied verbatim;
the Page Objects and specs are LLM-generated. Generation enforces the `automation/AGENTS.md`
conventions through both prompts and a regex convention-lint, and runs a validation loop
(`npm install` → `tsc --noEmit` → `playwright test --list`) that feeds failures back to the model
for up to three repair rounds per stage. Key flags: `--plan`, `--site-model`, `--output`,
`--skip-validate` (skips npm/tsc/list; lint still runs).

```bash
node dist/cli/index.js generate            # → automation-tests/
cd automation-tests && npm install && npx playwright test
```

## Development

```bash
npm test              # vitest unit tests (no network, no LLM, no browser)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (strict type-checked + component-isolation boundaries)
npm run format        # prettier
```

### Layout

- `src/cli/` — commander root + one file per subcommand (composition root)
- `src/core/` — shared infra: config loader, workspace, artifact IO, logger, errors, ids,
  semaphore, browser launch/context, auth (smart auth + session guard)
- `src/llm/` — provider interface + factory; `FakeLlmProvider` is the first-class test utility
- `src/schemas/` — Zod schemas + inferred types for every artifact (snake_case JSON keys)
- `src/<component>/` — pipeline components (`crawler`, `planner`, `executor`, …); may import only
  `core`, `llm`, `schemas` and the shared `coverage` / `reporter` libraries — never each other
- `src/coverage/`, `src/reporter/` — shared libraries any component may import
- `templates/generated-project/` — static scaffold emitted by the generator
- `tests/` — vitest unit tests mirroring `src/`

Artifacts carry `schema_version` + `generated_by`; readers reject major-version mismatches.
Artifact discovery: explicit `--input`-style flag → `latest.json` pointer → error naming the
prerequisite command.
