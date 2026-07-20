/**
 * `qa-ai plan` (plan §6.2, §7). Reads the latest SiteModel (or an explicit
 * `--site-model`), computes coverage gaps, asks the planner for a TestPlan
 * (deterministic fallback on any LLM failure), and writes the plan artifact
 * (updating the plans `latest.json` pointer). An LLM provider is always
 * attached — provider construction never fails; only the call can, and the
 * planner falls back gracefully.
 */

import { join } from "node:path";

import type { Command } from "commander";

import { readArtifact, resolveArtifactPath, writeArtifact } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config/load-config.js";
import { ConfigError } from "../../core/errors.js";
import { newPlanId } from "../../core/ids.js";
import { createLogger } from "../../core/logger.js";
import type { RunContext } from "../../core/run-context.js";
import { createWorkspace } from "../../core/workspace.js";
import { createProvider } from "../../llm/factory.js";
import { SiteModelSchema } from "../../schemas/site-model.js";
import { TestPlanSchema } from "../../schemas/test-plan.js";
import { generatePlan } from "../../planner/index.js";
import { handleFatalError } from "../format-error.js";
import { globalOptions } from "../global-options.js";

interface PlanCommandOptions {
  siteModel?: string;
  coverage?: string;
  maxTests?: string;
  output?: string;
}

function parseMaxTests(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigError(`--max-tests must be a positive integer (got '${value}').`);
  }
  return parsed;
}

export function registerPlanCommand(program: Command): void {
  program
    .command("plan")
    .description(
      "Generate a TestPlan from the SiteModel and coverage gaps (.qa/plans/plan-<ts>.json)",
    )
    .option("--site-model <path>", "explicit SiteModel path (default: latest crawl output)")
    .option("--coverage <path>", "explicit coverage registry path")
    .option("--max-tests <n>", "maximum test cases to plan (overrides config)")
    .option("--output <path>", "write the TestPlan to an explicit path")
    .action(async (options: PlanCommandOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const logger = createLogger({
          level: globals.verbose === true ? "debug" : "info",
          scope: "plan",
        });

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

        const plan = await generatePlan(ctx, siteModel, {
          maxTests: parseMaxTests(options.maxTests),
          coveragePath: options.coverage,
        });

        const outputPath = options.output ?? join(workspace.plansDir, `${newPlanId()}.json`);
        writeArtifact({
          schema: TestPlanSchema,
          kind: "test-plan",
          path: outputPath,
          data: plan,
          updateLatest: { workspace, dir: "plans" },
        });
        logger.info(
          `Wrote test plan: ${outputPath} (${String(plan.test_cases.length)} test cases)`,
        );
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
