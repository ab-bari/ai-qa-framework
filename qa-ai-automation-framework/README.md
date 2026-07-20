# qa-ai-automation-framework

AI-driven QA automation framework in TypeScript. Six independently-runnable components exchange
artifacts on disk — no component imports another:

```
qa-ai crawl          → .qa/site-model/site-model.json          (SiteModel)
qa-ai plan           → .qa/plans/plan-<ts>.json                (TestPlan)
qa-ai execute        → .qa/runs/run-<ts>/run-result.json       (RunResult)
qa-ai generate       → .qa/generated-tests/                    (standalone Playwright project)
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
| 2     | Crawler                                                                                | ⬜      |
| 3     | Planner + coverage read path                                                           | ⬜      |
| 4     | Executor + coverage write + reporter                                                   | ⬜      |
| 5     | Generator (standalone Playwright project)                                              | ⬜      |
| 6     | Automation runner                                                                      | ⬜      |
| 7     | Healer                                                                                 | ⬜      |
| 8     | Pipeline + polish                                                                      | ⬜      |

## Development

```bash
npm test              # vitest unit tests (no network, no LLM, no browser)
npm run typecheck     # tsc --noEmit
npm run lint          # eslint (strict type-checked + component-isolation boundaries)
npm run format        # prettier
```

### Layout

- `src/cli/` — commander root + one file per subcommand (composition root)
- `src/core/` — shared infra: config loader, workspace, artifact IO, logger, errors, ids
- `src/schemas/` — Zod schemas + inferred types for every artifact (snake_case JSON keys)
- `src/<component>/` — pipeline components; may import only `core`, `llm`, `schemas`
- `templates/generated-project/` — static scaffold emitted by the generator
- `tests/` — vitest unit tests mirroring `src/`

Artifacts carry `schema_version` + `generated_by`; readers reject major-version mismatches.
Artifact discovery: explicit `--input`-style flag → `latest.json` pointer → error naming the
prerequisite command.
