import type { Command } from "commander";

import { notImplemented } from "./stub.js";

export const PIPELINE_STEPS = [
  "crawl",
  "plan",
  "execute",
  "generate",
  "run-generated",
  "heal",
] as const;

export function registerPipelineCommand(program: Command): void {
  program
    .command("pipeline")
    .description(`Chain stages in order: ${PIPELINE_STEPS.join(" -> ")}`)
    .option("--from <step>", "first stage to run", "crawl")
    .option("--to <step>", "last stage to run", "heal")
    .action(() => {
      notImplemented("pipeline", 8);
    });
}
