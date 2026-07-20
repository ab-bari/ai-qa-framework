#!/usr/bin/env node
/**
 * qa-ai — AI-driven QA automation framework CLI (plan §7).
 * Six pipeline commands + pipeline/doctor, communicating only via artifacts.
 */

import { Command } from "commander";

import { registerCrawlCommand } from "./commands/crawl.js";
import { registerPlanCommand } from "./commands/plan.js";
import { registerExecuteCommand } from "./commands/execute.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerRunGeneratedCommand } from "./commands/run-generated.js";
import { registerHealCommand } from "./commands/heal.js";
import { registerPipelineCommand } from "./commands/pipeline.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerAiEchoCommand } from "./commands/ai-echo.js";
import { handleFatalError } from "./format-error.js";
import { getPackageInfo } from "../core/version.js";

const program = new Command();

program
  .name("qa-ai")
  .description(
    "AI-driven QA automation: crawl -> plan -> execute -> generate -> run-generated -> heal",
  )
  .version(getPackageInfo().version)
  .option("--config <path>", "path to the qa-ai config file", "./qa-config.json")
  .option("--workspace <dir>", "workspace directory (default: workspace_dir from config, else .qa)")
  .option("--verbose", "verbose output, including stack traces on errors", false);

registerCrawlCommand(program);
registerPlanCommand(program);
registerExecuteCommand(program);
registerGenerateCommand(program);
registerRunGeneratedCommand(program);
registerHealCommand(program);
registerPipelineCommand(program);
registerDoctorCommand(program);
registerAiEchoCommand(program);

try {
  await program.parseAsync(process.argv);
} catch (error) {
  handleFatalError(error, program.opts<{ verbose?: boolean }>().verbose === true);
}
