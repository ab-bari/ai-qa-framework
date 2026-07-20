/**
 * `qa-ai generate` (plan §6.4; PHASE_5_GENERATOR_PLAN). Reads the latest
 * TestPlan and SiteModel (or explicit `--plan` / `--site-model`), derives real
 * Playwright locators from the SiteModel, and emits a self-contained standalone
 * Playwright project at `automation-tests/` (a sibling of `.qa/`, NOT inside
 * it). Inputs are TestPlan + SiteModel only — there is no `--run-result`.
 */

import type { Command } from "commander";

import { readArtifact, resolveArtifactPath } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config/load-config.js";
import { createLogger } from "../../core/logger.js";
import type { RunContext } from "../../core/run-context.js";
import { createWorkspace } from "../../core/workspace.js";
import { createProvider } from "../../llm/factory.js";
import { SiteModelSchema } from "../../schemas/site-model.js";
import { TestPlanSchema } from "../../schemas/test-plan.js";
import { runGenerate } from "../../generator/index.js";
import { handleFatalError } from "../format-error.js";
import { globalOptions } from "../global-options.js";

interface GenerateCommandOptions {
  plan?: string;
  siteModel?: string;
  output?: string;
  skipValidate?: boolean;
}

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description(
      "Generate a standalone Playwright project (automation-tests/) from the TestPlan + SiteModel",
    )
    .option("--plan <path>", "explicit TestPlan path (default: latest plan)")
    .option("--site-model <path>", "explicit SiteModel path (default: latest crawl output)")
    .option("--output <path>", "output directory (default: <root>/automation-tests)")
    .option("--skip-validate", "skip the npm/tsc/--list validation loop (lint still runs)", false)
    .action(async (options: GenerateCommandOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const logger = createLogger({
          level: globals.verbose === true ? "debug" : "info",
          scope: "generate",
        });

        const planPath = resolveArtifactPath({
          explicitPath: options.plan,
          workspace,
          latestDir: "plans",
          artifactName: "test plan",
          producingCommand: "qa-ai plan",
        });
        const plan = readArtifact(TestPlanSchema, planPath, "test-plan");
        logger.info(`Loaded test plan: ${planPath} (${String(plan.test_cases.length)} test cases)`);

        const siteModelPath = resolveArtifactPath({
          explicitPath: options.siteModel,
          workspace,
          latestDir: "site-model",
          artifactName: "site model",
          producingCommand: "qa-ai crawl",
        });
        const siteModel = readArtifact(SiteModelSchema, siteModelPath, "site-model");
        logger.info(
          `Loaded site model: ${siteModelPath} (${String(siteModel.pages.length)} pages)`,
        );

        const ctx: RunContext = {
          config,
          workspace,
          logger,
          llm: createProvider(config, { workspace }),
        };

        const result = await runGenerate(ctx, plan, siteModel, {
          outputDir: options.output ?? workspace.automationTestsDir,
          siteModelPath,
          skipValidate: options.skipValidate === true,
        });

        logger.info(
          `Generated project at ${result.projectDir}: ` +
            `${String(result.pageObjectCount)} page object(s), ${String(result.specCount)} spec(s), ` +
            `${String(result.fileCount)} file(s) total; ${String(result.repairRounds)} repair round(s).`,
        );
        if (result.lintViolations.length > 0) {
          logger.warn(
            `${String(result.lintViolations.length)} convention lint warning(s) — see the manifest.`,
          );
        }
        logger.info(`Manifest: ${result.manifestPath}`);
        logger.info(`Next: cd ${result.projectDir} && npm install && npx playwright test`);
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
