import type { Command } from "commander";

import { notImplemented } from "./stub.js";

export function registerExecuteCommand(program: Command): void {
  program
    .command("execute")
    .description("Execute the TestPlan with Playwright and record a RunResult (.qa/runs/run-<ts>/)")
    .option("--plan <path>", "explicit TestPlan path (default: latest plan)")
    .option("--site-model <path>", "explicit SiteModel path (default: latest crawl output)")
    .option("--headed", "run the browser headed", false)
    .option("--max-parallel <n>", "max parallel browser contexts (overrides config)")
    .option("--filter <pattern>", "only run tests whose id or name matches this pattern")
    .action(() => {
      notImplemented("execute", 4);
    });
}
