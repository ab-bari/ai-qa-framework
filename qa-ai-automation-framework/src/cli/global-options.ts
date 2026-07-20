import type { Command } from "commander";

export interface GlobalOptions {
  config: string;
  workspace?: string;
  verbose?: boolean;
}

/** Read the root program's global flags from within a subcommand action. */
export function globalOptions(command: Command): GlobalOptions {
  const opts = command.optsWithGlobals<Record<string, unknown>>();
  return {
    config: typeof opts.config === "string" ? opts.config : "./qa-config.json",
    ...(typeof opts.workspace === "string" ? { workspace: opts.workspace } : {}),
    verbose: opts.verbose === true,
  };
}
