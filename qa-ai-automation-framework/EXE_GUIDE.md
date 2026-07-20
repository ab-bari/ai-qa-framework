# Execution Guide — qa-ai-automation-framework

This guide covers how to run the three implemented pipeline components — **crawler → planner → executor** — end to end. They communicate only through `.qa/` artifacts, so they run in that order: the crawler writes a SiteModel, the planner reads it and writes a TestPlan, the executor reads both and writes a RunResult + coverage + HTML report.

All commands run from the framework folder:

```bash
cd d:/GitHub/ai-qa-framework/qa-ai-automation-framework
```

## Two ways to run every command

Every component supports both invocation styles. Anywhere this guide shows one, the other works identically — only the leading tokens change; the subcommand, flags, and arguments are the same.

```bash
# A) Run the built CLI (requires `npm run build` first)
node dist/cli/index.js --config qa-config.json <command> [flags]

# B) Run from TypeScript source without building (tsx)
npm run dev -- --config qa-config.json <command> [flags]
```

- Use **(A)** for normal use and when verifying release behavior — it runs the compiled `dist/`.
- Use **(B)** during development — it runs the TS source directly via `tsx`, so no rebuild is needed after editing `src/`.
- Note the `--` after `npm run dev`: it passes everything that follows through to the CLI rather than to npm.

### Global flags (before the subcommand)

These are defined on the top-level program, so they go **before** the subcommand (`crawl` / `plan` / `execute`); per-command flags go after it.

| Global flag           | Purpose                                                              |
| --------------------- | ------------------------------------------------------------------- |
| `--config <path>`     | Path to the config file (default `./qa-config.json`)                |
| `--workspace <dir>`   | Workspace directory (default: `workspace_dir` from config, else `.qa`) |
| `--verbose`           | Verbose output, including stack traces and per-command debug detail |

```bash
# --verbose is global: it goes BEFORE the subcommand, like --config
node dist/cli/index.js --config qa-config.json --verbose plan --max-tests 8
```

---

## One-time setup

| Step             | Command                           | Notes                              |
| ---------------- | --------------------------------- | ---------------------------------- |
| Install deps     | `npm install`                     | Once per clone                     |
| Install browser  | `npx playwright install chromium` | Playwright's Chromium              |
| Build to `dist/` | `npm run build`                   | Needed for the `node dist/...` style; re-run after `src/` changes |
| Config file      | `qa-config.json` (gitignored)     | Copy `qa-config.example.json`, edit `target_url` / `auth` |

## Prerequisite: Claude Code authentication

LLM access is your Claude Pro/Max subscription via locally installed Claude Code — **no API key**. Authenticate once, then verify the environment:

```bash
claude login                     # authorizes your Pro/Max subscription (no API key)
node dist/cli/index.js doctor    # verifies Node, Claude, Chromium, config
```

Who needs auth:

- **Crawler** — only if `auth.llm_fallback: true` **and** heuristic login detection fails. With `llm_fallback: false` (the current `qa-config.json`), **no Claude auth is needed**.
- **Planner** — always calls the LLM. Without auth it does **not** error; it silently emits the weaker *deterministic fallback plan* instead. Run `doctor` to confirm auth before planning.
- **Executor** — calls the LLM for tier-2 self-healing and the AI run summary. Without auth it still runs, just without those.

---

# 1. Crawler

Explores the target site with a stealth browser, handles login, and produces a **SiteModel** (pages, elements, forms, screenshots, DOM snapshots, API endpoints).

## Run

```bash
# A) built CLI
node dist/cli/index.js --config qa-config.json crawl --max-pages 8

# B) from source
npm run dev -- --config qa-config.json crawl --max-pages 8
```

## Useful flags

| Flag                | Purpose                                                        |
| ------------------- | ------------------------------------------------------------- |
| `--max-pages <n>`   | Cap pages (overrides `crawl.max_pages` in config)             |
| `--headed`          | Watch the browser instead of running headless                 |
| `--output <path>`   | Write the SiteModel somewhere other than the default          |

(For per-page element/form counts and probe failures, add the global `--verbose` before `crawl`.)

## Example commands

```bash
# Quick shallow crawl, watch it happen
node dist/cli/index.js --config qa-config.json crawl --max-pages 5 --headed

# Full crawl with debug logging, from source (--verbose is global → before the subcommand)
npm run dev -- --config qa-config.json --verbose crawl

# Crawl and write the model to an explicit path
node dist/cli/index.js --config qa-config.json crawl --max-pages 8 --output ./tmp/site-model.json
```

## Output

```
.qa/site-model/site-model.json            ← the SiteModel artifact
.qa/site-model/pages/<page_id>/           ← screenshot.png + dom.html per page
.qa/site-model/latest.json                ← pointer consumed by the planner
```

Inspect it quickly:

```bash
node -e 'const m=require("./.qa/site-model/site-model.json");m.pages.forEach(p=>console.log(p.auth_required, p.page_type, p.url))'
```

## Point it at your own site

Edit `qa-config.json`:

- `target_url` — the site to crawl.
- `auth` — `null` for a public site, or fill in `login_url` / `username` / `password` (use `"env:MY_VAR"` to read a secret from an env var rather than committing it).
- `crawl.max_pages` / `max_depth` / `include_patterns` / `exclude_patterns` — scope control.

Then re-run the same `crawl` command.

---

# 2. Planner

Reads the SiteModel (plus any coverage history) and asks the LLM to design a prioritized **TestPlan** of functional + security test cases. Falls back to a deterministic plan if the LLM is unavailable or returns nothing valid.

## Prerequisites

- A SiteModel must exist — run the crawler first (`.qa/site-model/site-model.json`).
- Claude Code authenticated (`claude login`; verify with `doctor`). Without it you get the weaker fallback plan silently.

## Run

```bash
# A) built CLI
node dist/cli/index.js --config qa-config.json plan --max-tests 8

# B) from source
npm run dev -- --config qa-config.json plan --max-tests 8
```

## Useful flags

| Flag                   | Purpose                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| `--max-tests <n>`      | Override `max_tests_per_run` (config default: 20)                                         |
| `--site-model <path>`  | Use a specific SiteModel instead of the latest                                            |
| `--coverage <path>`    | Use a specific coverage registry (default `.qa/coverage/coverage-registry.json`; absent = first run, all pages untested) |
| `--output <path>`      | Write the plan somewhere explicit                                                         |

(To see dropped test cases and their reasons, add the global `--verbose` before `plan`.)

## Example commands

```bash
# Plan 8 tests against the latest crawl
node dist/cli/index.js --config qa-config.json plan --max-tests 8

# See why any test cases were dropped (--verbose is global → before the subcommand)
npm run dev -- --config qa-config.json --verbose plan --max-tests 12

# Plan from a specific site model
node dist/cli/index.js --config qa-config.json plan --site-model ./tmp/site-model.json
```

## Output

```
.qa/plans/plan-<timestamp>.json           ← the TestPlan artifact
.qa/plans/latest.json                     ← pointer consumed by the executor
```

Credentials are **not** baked into the plan — it stays credential-free with `{{auth_username}}`, `{{auth_password}}`, `{{auth_login_url}}`, and `{{$timestamp}}` placeholders that the executor resolves at run time.

## Steering the planner (config)

- **`hints: []`** — free-text prioritization guidance, e.g. `["focus on the checkout flow", "cart badge accuracy matters most"]`. This is the main lever for what gets tested.
- **`categories`** — currently `["functional", "security"]` (~60/40 budget split). Drop one to put 100% of the budget on the other. (`"visual"` is reserved and dropped by the validator in v1.)
- **`max_tests_per_run: 20`** — the default when you omit `--max-tests`.

Coverage feedback (steering toward untested/failed areas) only becomes meaningful once the executor has run at least once and written the coverage registry. On a first run the registry is empty and every page reads as untested.

---

# 3. Executor

Reads the TestPlan and SiteModel, resolves the `{{auth_*}}` placeholders, runs each test case in a stealth browser with two-tier self-healing, and writes a **RunResult**, updates the **coverage registry**, and emits an **HTML + JSON report**.

## Prerequisites

- A SiteModel **and** a TestPlan must exist — run `crawl` then `plan` first.
- Claude Code authenticated for tier-2 AI healing and the AI summary (`claude login`; verify with `doctor`). It runs without auth, just without those AI assists.

## Run

```bash
# A) built CLI
node dist/cli/index.js --config qa-config.json execute --max-parallel 2

# B) from source
npm run dev -- --config qa-config.json execute
```

## Useful flags

| Flag                    | Purpose                                                                    |
| ----------------------- | -------------------------------------------------------------------------- |
| `--plan <path>`         | Use a specific TestPlan instead of the latest                              |
| `--site-model <path>`   | Use a specific SiteModel instead of the latest                             |
| `--coverage <path>`     | Read/write a specific coverage registry (default `.qa/coverage/coverage-registry.json`) |
| `--headed`              | Watch the browser instead of running headless                              |
| `--max-parallel <n>`    | Concurrent browser contexts (overrides `max_parallel_contexts`, config default: 3) |
| `--filter <substr>`     | Only run test cases whose id or name contains this text                    |

(For debug logging, add the global `--verbose` before `execute`.)

## Example commands

```bash
# Run the latest plan with 2 parallel contexts
node dist/cli/index.js --config qa-config.json execute --max-parallel 2

# Watch a single test run, from source
npm run dev -- --config qa-config.json execute --filter login --headed

# Execute a specific plan file
node dist/cli/index.js --config qa-config.json execute --plan .qa/plans/plan-20260720-151540.json
```

## Output

```
.qa/runs/run-<timestamp>/report/report.html   ← self-contained HTML report
.qa/runs/run-<timestamp>/report/report.json   ← machine-readable report
.qa/runs/run-<timestamp>/...                   ← per-test evidence (screenshots, console/network logs, DOM)
.qa/coverage/coverage-registry.json            ← updated coverage (feeds the next plan)
```

Coverage is attributed to where the browser actually ended up (`actual_page_id`), not the plan's target — so a login test that lands on the dashboard credits the dashboard. Regression detection runs automatically against the previous run in `.qa/runs/`.

## Exit codes

| Code | Meaning                                                        |
| ---- | ------------------------------------------------------------- |
| `0`  | All tests passed                                              |
| `3`  | Tests ran but one or more **failed** (distinct from an error) |
| other | Component error (bad config, missing artifact, crash)        |

Exit `3` is deliberately distinct so CI can tell "tests failed" apart from "the tool broke."

---

## End-to-end quick reference

```bash
# 0. one-time
npm install && npx playwright install chromium && npm run build
claude login && node dist/cli/index.js doctor

# 1. crawl → 2. plan → 3. execute
node dist/cli/index.js --config qa-config.json crawl   --max-pages 8
node dist/cli/index.js --config qa-config.json plan    --max-tests 8
node dist/cli/index.js --config qa-config.json execute --max-parallel 2
```

Or entirely from source (no build step):

```bash
npm run dev -- --config qa-config.json crawl   --max-pages 8
npm run dev -- --config qa-config.json plan    --max-tests 8
npm run dev -- --config qa-config.json execute --max-parallel 2
```
