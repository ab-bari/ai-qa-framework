import type { Command } from "commander";

import { notImplemented } from "./stub.js";

export function registerGenerateCommand(program: Command): void {
  program
    .command("generate")
    .description(
      "Generate a standalone Playwright test project from plan + site model + run result",
    )
    .option("--plan <path>", "explicit TestPlan path (default: latest plan)")
    .option("--site-model <path>", "explicit SiteModel path (default: latest crawl output)")
    .option("--run-result <path>", "explicit RunResult path (default: latest run)")
    .option("--output <path>", "output directory (default: .qa/generated-tests)")
    .option("--skip-validate", "skip the tsc/--list validation loop", false)
    .action(() => {
      notImplemented("generate", 5);
    });
}
