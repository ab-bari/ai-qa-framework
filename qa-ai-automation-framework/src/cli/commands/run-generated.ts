import type { Command } from "commander";

import { notImplemented } from "./stub.js";

export function registerRunGeneratedCommand(program: Command): void {
  program
    .command("run-generated")
    .description("Run the generated Playwright project (native HTML report + results.json handoff)")
    .option("--project <path>", "generated project directory (default: .qa/generated-tests)")
    .option("--grep <pattern>", "pass-through: only run tests matching this pattern")
    .option("--spec <file>", "pass-through: only run this spec file")
    .option("--headed", "pass-through: run the browser headed", false)
    .option("--workers <n>", "pass-through: number of Playwright workers")
    .option("--install", "force npm install in the generated project", false)
    .action(() => {
      notImplemented("run-generated", 6);
    });
}
