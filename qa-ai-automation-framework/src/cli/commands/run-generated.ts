/**
 * `qa-ai run-generated` (plan §6.5). Runs the generated `automation-tests/`
 * project with Playwright's own html + json reporters redirected into
 * `.qa/automation-runs/run-<ts>/`. No AI, no custom result mapping: the HTML
 * report is the human output and results.json is the machine handoff to
 * `qa-ai heal`. Exit code mirrors Playwright (3 when tests fail).
 */

import type { Command } from "commander";

import { createLogger } from "../../core/logger.js";
import type { RunContext } from "../../core/run-context.js";
import { createWorkspace } from "../../core/workspace.js";
import { loadConfig } from "../../core/config/load-config.js";
import { runGenerated } from "../../automation-runner/index.js";
import { handleFatalError } from "../format-error.js";
import { globalOptions } from "../global-options.js";

interface RunGeneratedCommandOptions {
  project?: string;
  grep?: string;
  spec?: string;
  headed?: boolean;
  workers?: string;
  install?: boolean;
}

export function registerRunGeneratedCommand(program: Command): void {
  program
    .command("run-generated")
    .description("Run the generated Playwright project (native HTML report + results.json handoff)")
    .option("--project <path>", "generated project directory (default: automation-tests)")
    .option("--grep <pattern>", "pass-through: only run tests matching this pattern")
    .option("--spec <file>", "pass-through: only run this spec file")
    .option("--headed", "pass-through: run the browser headed", false)
    .option("--workers <n>", "pass-through: number of Playwright workers")
    .option("--install", "force npm install in the generated project", false)
    .action(async (options: RunGeneratedCommandOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const logger = createLogger({
          level: globals.verbose === true ? "debug" : "info",
          scope: "run-generated",
        });

        const workers =
          options.workers === undefined ? undefined : Number.parseInt(options.workers, 10);
        if (workers !== undefined && Number.isNaN(workers)) {
          throw new Error(`--workers must be a number, got "${String(options.workers)}"`);
        }

        const ctx: RunContext = { config, workspace, logger };
        const result = await runGenerated(ctx, {
          projectDir: options.project ?? workspace.automationTestsDir,
          grep: options.grep,
          spec: options.spec,
          headed: options.headed,
          workers,
          install: options.install,
        });

        // Exit code mirrors Playwright (plan §7): 0 when all tests passed,
        // 3 when tests failed. Reports are always written either way.
        process.exitCode = result.playwrightExitCode === 0 ? 0 : 3;
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
