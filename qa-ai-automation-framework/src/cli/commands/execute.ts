/**
 * `qa-ai execute` (plan §6.3, §7). Reads the latest TestPlan + SiteModel, runs
 * the plan against the live site, then writes the RunResult artifact, updates
 * the coverage registry (the feedback the NEXT `qa-ai plan` consumes), and
 * generates the HTML + JSON reports.
 *
 * Exit code 3 signals "tests failed" (plan §7) — distinct from a component
 * error, so CI can tell a red suite from a broken run.
 */

import { join } from "node:path";

import type { Command } from "commander";

import { readArtifact, resolveArtifactPath, writeArtifact } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config/load-config.js";
import { ConfigError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import type { RunContext } from "../../core/run-context.js";
import { createWorkspace } from "../../core/workspace.js";
import {
  loadCoverageRegistry,
  saveCoverageRegistry,
  updateRegistryFromRun,
} from "../../coverage/registry.js";
import { coverageSummary } from "../../coverage/scorer.js";
import { executePlan } from "../../executor/index.js";
import { createProvider } from "../../llm/factory.js";
import { generateReports } from "../../reporter/index.js";
import { RunResultSchema } from "../../schemas/run-result.js";
import { SiteModelSchema } from "../../schemas/site-model.js";
import { TestPlanSchema } from "../../schemas/test-plan.js";
import { handleFatalError } from "../format-error.js";
import { globalOptions } from "../global-options.js";

interface ExecuteCommandOptions {
  plan?: string;
  siteModel?: string;
  coverage?: string;
  headed: boolean;
  maxParallel?: string;
  filter?: string;
}

function parseMaxParallel(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigError(`--max-parallel must be a positive integer (got '${value}').`);
  }
  return parsed;
}

export function registerExecuteCommand(program: Command): void {
  program
    .command("execute")
    .description("Execute the TestPlan with Playwright and record a RunResult (.qa/runs/run-<ts>/)")
    .option("--plan <path>", "explicit TestPlan path (default: latest plan)")
    .option("--site-model <path>", "explicit SiteModel path (default: latest crawl output)")
    .option("--coverage <path>", "explicit coverage registry path")
    .option("--headed", "run the browser headed", false)
    .option("--max-parallel <n>", "max parallel browser contexts (overrides config)")
    .option("--filter <pattern>", "only run tests whose id or name contains this text")
    .action(async (options: ExecuteCommandOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const logger = createLogger({
          level: globals.verbose === true ? "debug" : "info",
          scope: "execute",
        });

        const planPath = resolveArtifactPath({
          explicitPath: options.plan,
          workspace,
          latestDir: "plans",
          artifactName: "test plan",
          producingCommand: "qa-ai plan",
        });
        const plan = readArtifact(TestPlanSchema, planPath, "test-plan");
        logger.info(`Loaded plan: ${planPath} (${String(plan.test_cases.length)} test cases)`);

        const siteModelPath = resolveArtifactPath({
          explicitPath: options.siteModel,
          workspace,
          latestDir: "site-model",
          artifactName: "site model",
          producingCommand: "qa-ai crawl",
        });
        const siteModel = readArtifact(SiteModelSchema, siteModelPath, "site-model");
        logger.info(`Loaded site model: ${siteModelPath} (${String(siteModel.pages.length)} pages)`);

        const ctx: RunContext = {
          config,
          workspace,
          logger,
          llm: createProvider(config, { workspace }),
        };

        const { runResult, runDir } = await executePlan(ctx, plan, siteModel, {
          maxParallel: parseMaxParallel(options.maxParallel),
          headed: options.headed,
          filter: options.filter,
        });

        // Coverage write path — the feedback loop into the next plan.
        const registryPath = options.coverage ?? workspace.coverageRegistryPath;
        const registry = updateRegistryFromRun(
          loadCoverageRegistry(registryPath, plan.target_url),
          runResult,
          { siteModel, historyRetention: config.history_retention_runs },
        );
        saveCoverageRegistry(registry, registryPath);
        logger.info(`Updated coverage registry: ${registryPath}`);

        const reports = await generateReports(runResult, {
          workspace,
          logger,
          runDir,
          registry,
          llm: ctx.llm,
        });

        // Written last so the artifact carries the generated ai_summary.
        const runResultPath = join(runDir, "run-result.json");
        writeArtifact({
          schema: RunResultSchema,
          kind: "run-result",
          path: runResultPath,
          data: runResult,
          updateLatest: { workspace, dir: "runs" },
        });

        logger.info(`Wrote run result: ${runResultPath}`);
        logger.info(`HTML report: ${reports.htmlPath}`);
        console.log(
          `\n${runResult.passed} passed, ${runResult.failed} failed, ` +
            `${runResult.skipped} skipped, ${runResult.errors} errors ` +
            `(${runResult.duration_seconds.toFixed(1)}s)\n` +
            `${coverageSummary(registry)}\n\nReport: ${reports.htmlPath}`,
        );

        if (runResult.failed > 0 || runResult.errors > 0) {
          process.exitCode = 3;
        }
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
