import type { Command } from "commander";

import { notImplemented } from "./stub.js";

export function registerHealCommand(program: Command): void {
  program
    .command("heal")
    .description(
      "Triage and fix failing generated tests in place, verify by re-running, and report",
    )
    .option("--run <path>", "automation run folder or results.json path (default: latest run)")
    .option("--project <path>", "generated project directory (default: automation-tests)")
    .option("--max-attempts <n>", "patch/verify attempts per test before giving up", "3")
    .option("--test <title>", "only heal the test with this title")
    .option("--no-live-dom", "use trace snapshots instead of re-navigating for live DOM context")
    .option("--verify-suite", "re-run the full suite after healing to catch regressions", false)
    .action(() => {
      notImplemented("heal", 7);
    });
}
