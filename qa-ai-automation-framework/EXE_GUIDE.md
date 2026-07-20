## One-time setup (already done this session)

All commands run from the framework folder:

```bash
cd d:/GitHub/ai-qa-framework/qa-ai-automation-framework
```

| Step             | Command                           | Status                |
| ---------------- | --------------------------------- | --------------------- |
| Install deps     | `npm install`                     | ✅ done                |
| Install browser  | `npx playwright install chromium` | ✅ done                |
| Build to `dist/` | `npm run build`                   | ✅ done                |
| Config file      | `qa-config.json` (gitignored)     | ✅ created (saucedemo) |

If you clone this fresh on another machine, you'd run the first three, then create `qa-config.json` by copying `qa-config.example.json` and editing `target_url` / `auth`.

## Prerequisite for authenticated crawls

The crawler only calls the LLM if auth's `llm_fallback` is `true` **and** the heuristic detection fails. If you enable that, Claude Code must be authorized first:

```bash
claude login          # authorizes your Pro/Max subscription (no API key)
node dist/cli/index.js doctor   # verifies Node, Claude, Chromium, config
```

The current `qa-config.json` has `llm_fallback: false`, so **no Claude auth is needed** for the saucedemo crawl.

## Run the crawler

Two equivalent ways:

```bash
# A) Run the built CLI (what we used to verify)
node dist/cli/index.js --config qa-config.json crawl --max-pages 8

# B) Run from TypeScript source without building (tsx)
npm run dev -- --config qa-config.json crawl --max-pages 8
```

Useful flags:

- `--max-pages <n>` — cap pages (overrides config)
- `--headed` — watch the browser instead of headless
- `--output <path>` — write the SiteModel somewhere other than the default
- `--verbose` — debug logging (per-page element/form counts, probe failures)

## Where the output goes

```
.qa/site-model/site-model.json          ← the SiteModel artifact
.qa/site-model/pages/<page_id>/          ← screenshot.png + dom.html per page
.qa/site-model/latest.json               ← pointer consumed by the next stage
```

Inspect it quickly:

```bash
node -e 'const m=require("./.qa/site-model/site-model.json");m.pages.forEach(p=>console.log(p.auth_required, p.page_type, p.url))'
```

## To point it at your own site

Edit `qa-config.json`:

- `target_url` — the site to crawl
- `auth` — set to `null` for a public site, or fill in `login_url`/`username`/`password` (use `"env:MY_VAR"` to read a secret from an env var rather than committing it)
- `crawl.max_pages` / `max_depth` / `include_patterns` / `exclude_patterns` — scope control

Then just re-run the same `crawl` command.


# Planner
## Setup (one-time, mostly already done)

**1. Be in the framework directory** — all commands run from here:

```powershell
cd d:\GitHub\ai-qa-framework\qa-ai-automation-framework
```

**2. Build** (only needed after source changes — already built):

```powershell
npm run build
```

**3. Make sure Claude Code is authenticated.** The planner always calls the LLM through your Claude subscription. If it isn't logged in, the planner won't error — it silently produces the _deterministic fallback plan_ instead, which is much weaker. Verify with:

```powershell
node dist/cli/index.js doctor
```

If it reports an auth problem, run `claude login` once.

**4. A SiteModel must exist** — the planner reads the crawler's output. You already have one at `.qa/site-model/site-model.json`. If you need a fresh one:

```powershell
node dist/cli/index.js --config qa-config.json crawl --max-pages 8
```

## Run the planner

```powershell
node dist/cli/index.js --config qa-config.json plan --max-tests 8
```

Or without building, straight from source:

```powershell
npm run dev -- --config qa-config.json plan --max-tests 8
```

**Output:** `.qa/plans/plan-<timestamp>.json`, plus `.qa/plans/latest.json` pointing at it (that's how `execute` will find it in Phase 4).

## Useful flags

|Flag|Purpose|
|---|---|
|`--max-tests <n>`|Override `max_tests_per_run` (config default: 20)|
|`--site-model <path>`|Use a specific SiteModel instead of the latest|
|`--coverage <path>`|Use a specific coverage registry (default `.qa/coverage/coverage-registry.json`; absent = first run, all pages untested)|
|`--output <path>`|Write the plan somewhere explicit|
|`--verbose`|Debug logging — also shows dropped test cases and their reasons|

## Optional config tweaks worth knowing

- **`hints: []`** — free-text prioritization guidance fed to the planner, e.g. `["focus on the checkout flow", "cart badge accuracy matters most"]`. This is the main lever for steering what gets tested.
- **`categories`** — currently `["functional", "security"]` giving a ~60/40 budget split. Drop one to get 100% of the budget on the other. (`"visual"` is reserved and will be dropped by the validator in v1.)
- **`max_tests_per_run: 20`** — the config default when you omit `--max-tests`.

One note on repeat runs: coverage feedback (the planner steering toward untested/failed areas) only becomes meaningful once the executor starts _writing_ the coverage registry — that's Phase 4. Right now every run sees an empty registry and treats all pages as untested.