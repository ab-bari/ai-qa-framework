/**
 * `qa-ai doctor` — environment checks (plan §7): Node >= 20, claude CLI on
 * PATH, Playwright browsers, config validity. Phase 1 extends the Claude
 * check with a full AI round-trip; Phase 0 verifies CLI presence.
 */

import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import type { Command } from "commander";

import { globalOptions } from "../global-options.js";
import { loadConfig } from "../../core/config/load-config.js";
import { QaError } from "../../core/errors.js";
import { readArtifact } from "../../core/artifacts.js";
import { createWorkspace, type Workspace } from "../../core/workspace.js";
import { createProvider } from "../../llm/factory.js";
import type { FrameworkConfig } from "../../schemas/config.js";
import { CoverageRegistrySchema } from "../../schemas/coverage.js";
import { HealingReportSchema } from "../../schemas/healing-report.js";
import { RunResultSchema } from "../../schemas/run-result.js";
import { SiteModelSchema } from "../../schemas/site-model.js";
import { TestPlanSchema } from "../../schemas/test-plan.js";
import type { ArtifactKind } from "../../schemas/versions.js";
import type { z } from "zod";

type CheckStatus = "ok" | "warn" | "fail";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  remediation?: string;
}

const MIN_NODE_MAJOR = 20;

function checkNode(): CheckResult {
  const version = process.versions.node;
  const major = Number.parseInt(version.split(".")[0] ?? "0", 10);
  if (major >= MIN_NODE_MAJOR) {
    return { name: "Node.js", status: "ok", detail: `v${version} (>= ${MIN_NODE_MAJOR} required)` };
  }
  return {
    name: "Node.js",
    status: "fail",
    detail: `v${version} is below the required Node ${MIN_NODE_MAJOR}`,
    remediation: `Install Node.js ${MIN_NODE_MAJOR} or newer.`,
  };
}

function checkClaudeCli(): CheckResult {
  // Single command string + shell:true resolves .cmd shims on Windows without
  // tripping Node's DEP0190 args-with-shell deprecation.
  const result = spawnSync("claude --version", {
    encoding: "utf8",
    shell: true,
    timeout: 30_000,
  });
  if (result.error !== undefined || result.status !== 0) {
    return {
      name: "Claude Code",
      status: "fail",
      detail: "claude CLI not found on PATH",
      remediation:
        "Install Claude Code (https://claude.com/claude-code), then run 'claude login' to authorize your subscription.",
    };
  }
  const version = result.stdout.trim().split("\n")[0] ?? "";
  return {
    name: "Claude Code",
    status: "ok",
    detail: `${version} on PATH (see the Claude AI check below for auth)`,
  };
}

function playwrightBrowsersDir(): string | null {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override !== undefined && override !== "" && override !== "0") {
    return override;
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ms-playwright");
}

function checkPlaywrightBrowsers(): CheckResult {
  const dir = playwrightBrowsersDir();
  if (dir !== null && existsSync(dir)) {
    const chromium = readdirSync(dir).find((entry) => entry.startsWith("chromium"));
    if (chromium !== undefined) {
      return { name: "Playwright", status: "ok", detail: `${chromium} found in ${dir}` };
    }
  }
  return {
    name: "Playwright",
    status: "warn",
    detail: "chromium browser not found (needed from Phase 2 onward)",
    remediation: "npx playwright install chromium",
  };
}

function checkConfig(configPath: string): { result: CheckResult; config: FrameworkConfig | null } {
  if (!existsSync(configPath)) {
    return {
      result: {
        name: "Config",
        status: "warn",
        detail: `no config file at ${configPath}`,
        remediation: "Copy qa-config.example.json to qa-config.json and edit it.",
      },
      config: null,
    };
  }
  try {
    const config = loadConfig(configPath);
    return {
      result: {
        name: "Config",
        status: "ok",
        detail: `${configPath} valid (target: ${config.target_url}, provider: ${config.ai_provider})`,
      },
      config,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      result: {
        name: "Config",
        status: "fail",
        detail: message,
        ...(error instanceof QaError && error.remediation !== undefined
          ? { remediation: error.remediation }
          : {}),
      },
      config: null,
    };
  }
}

interface KnownArtifact {
  label: string;
  kind: ArtifactKind;
  schema: z.ZodType;
  locate: (workspace: Workspace) => string | null;
}

const KNOWN_ARTIFACTS: KnownArtifact[] = [
  {
    label: "site-model",
    kind: "site-model",
    schema: SiteModelSchema,
    locate: (ws) => (existsSync(ws.siteModelPath) ? ws.siteModelPath : null),
  },
  {
    label: "test-plan",
    kind: "test-plan",
    schema: TestPlanSchema,
    locate: (ws) => ws.readLatestPointer("plans"),
  },
  {
    label: "run-result",
    kind: "run-result",
    schema: RunResultSchema,
    locate: (ws) => ws.readLatestPointer("runs"),
  },
  {
    label: "coverage-registry",
    kind: "coverage-registry",
    schema: CoverageRegistrySchema,
    locate: (ws) => (existsSync(ws.coverageRegistryPath) ? ws.coverageRegistryPath : null),
  },
  {
    label: "healing-report",
    kind: "healing-report",
    schema: HealingReportSchema,
    locate: (ws) => ws.readLatestPointer("healing"),
  },
];

function validateArtifacts(workspace: Workspace): CheckResult[] {
  const results: CheckResult[] = [];
  for (const artifact of KNOWN_ARTIFACTS) {
    let located: string | null;
    try {
      located = artifact.locate(workspace);
    } catch (error) {
      results.push({
        name: `Artifact ${artifact.label}`,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
      });
      continue;
    }
    if (located === null || !existsSync(located)) {
      continue; // Absent artifacts are fine — the pipeline just hasn't run yet.
    }
    try {
      readArtifact(artifact.schema, located, artifact.kind);
      results.push({ name: `Artifact ${artifact.label}`, status: "ok", detail: located });
    } catch (error) {
      results.push({
        name: `Artifact ${artifact.label}`,
        status: "fail",
        detail: error instanceof Error ? error.message : String(error),
        ...(error instanceof QaError && error.remediation !== undefined
          ? { remediation: error.remediation }
          : {}),
      });
    }
  }
  return results;
}

function printResults(results: CheckResult[]): void {
  const statusLabel: Record<CheckStatus, string> = { ok: "ok  ", warn: "warn", fail: "FAIL" };
  console.log("qa-ai doctor\n");
  const nameWidth = Math.max(...results.map((r) => r.name.length)) + 2;
  for (const result of results) {
    console.log(
      `  ${statusLabel[result.status]}  ${result.name.padEnd(nameWidth)}${result.detail}`,
    );
    if (result.remediation !== undefined) {
      console.log(`        ${" ".repeat(nameWidth)}-> ${result.remediation}`);
    }
  }
  const counts = {
    ok: results.filter((r) => r.status === "ok").length,
    warn: results.filter((r) => r.status === "warn").length,
    fail: results.filter((r) => r.status === "fail").length,
  };
  console.log(`\n${counts.ok} ok, ${counts.warn} warning(s), ${counts.fail} failed`);
}

/**
 * Full AI round-trip check (plan §1/§9): build the configured provider and run
 * its healthCheck (one real LLM call). Skipped with --skip-ai or when no config
 * is loaded, since it needs a target provider.
 */
async function checkAiRoundTrip(
  config: FrameworkConfig,
  workspace: Workspace,
): Promise<CheckResult> {
  let provider;
  try {
    provider = createProvider(config, { workspace });
  } catch (error) {
    return {
      name: "Claude AI",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
      ...(error instanceof QaError && error.remediation !== undefined
        ? { remediation: error.remediation }
        : {}),
    };
  }
  const health = await provider.healthCheck();
  if (health.ok) {
    return { name: "Claude AI", status: "ok", detail: `${provider.name}: ${health.detail}` };
  }
  return {
    name: "Claude AI",
    status: "fail",
    detail: `${provider.name}: ${health.detail}`,
    remediation: "Run `claude login` to authorize Claude Code, then re-run `qa-ai doctor`.",
  };
}

export function registerDoctorCommand(program: Command): void {
  program
    .command("doctor")
    .description(
      "Check the environment: Node version, Claude Code CLI + auth, Playwright browsers, config",
    )
    .option("--validate-artifacts", "also validate existing workspace artifacts", false)
    .option("--skip-ai", "skip the live Claude AI round-trip check", false)
    .action(async (options: { validateArtifacts: boolean; skipAi: boolean }, command: Command) => {
      const globals = globalOptions(command);
      const results: CheckResult[] = [checkNode(), checkClaudeCli(), checkPlaywrightBrowsers()];
      const { result: configResult, config } = checkConfig(globals.config);
      results.push(configResult);

      const workspace = createWorkspace({
        cliWorkspace: globals.workspace,
        configWorkspaceDir: config?.workspace_dir,
      });

      if (!options.skipAi) {
        if (config === null) {
          results.push({
            name: "Claude AI",
            status: "warn",
            detail: "skipped — no config to select a provider",
            remediation: "Create qa-config.json, or pass --skip-ai to suppress this check.",
          });
        } else {
          results.push(await checkAiRoundTrip(config, workspace));
        }
      }

      if (options.validateArtifacts) {
        results.push(...validateArtifacts(workspace));
      }

      printResults(results);
      if (results.some((r) => r.status === "fail")) {
        process.exitCode = 1;
      }
    });
}
