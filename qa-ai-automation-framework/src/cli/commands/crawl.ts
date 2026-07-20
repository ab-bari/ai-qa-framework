/**
 * `qa-ai crawl` (plan §6.1, §7). Builds a RunContext, runs the crawler, and
 * writes the SiteModel artifact (updating the site-model `latest.json` pointer).
 * An LLM provider is attached only when auth with `llm_fallback` is configured
 * (the crawler's sole AI touchpoint).
 */

import type { Command } from "commander";

import { writeArtifact } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config/load-config.js";
import { ConfigError } from "../../core/errors.js";
import { createLogger } from "../../core/logger.js";
import type { RunContext } from "../../core/run-context.js";
import { createWorkspace } from "../../core/workspace.js";
import { runCrawl } from "../../crawler/index.js";
import { createProvider } from "../../llm/factory.js";
import { SiteModelSchema } from "../../schemas/site-model.js";
import { handleFatalError } from "../format-error.js";
import { globalOptions } from "../global-options.js";

interface CrawlOptions {
  maxPages?: string;
  output?: string;
  headed: boolean;
}

function parseMaxPages(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    throw new ConfigError(`--max-pages must be a positive integer (got '${value}').`);
  }
  return parsed;
}

export function registerCrawlCommand(program: Command): void {
  program
    .command("crawl")
    .description("Crawl the target site into a SiteModel artifact (.qa/site-model/site-model.json)")
    .option("--max-pages <n>", "maximum pages to crawl (overrides config)")
    .option("--output <path>", "write the SiteModel to an explicit path")
    .option("--headed", "run the browser headed (visible) for debugging", false)
    .action(async (options: CrawlOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const logger = createLogger({
          level: globals.verbose === true ? "debug" : "info",
          scope: "crawl",
        });

        const needsLlm = config.auth?.llm_fallback === true;
        const ctx: RunContext = {
          config,
          workspace,
          logger,
          ...(needsLlm ? { llm: createProvider(config, { workspace }) } : {}),
        };

        const maxPages = parseMaxPages(options.maxPages);
        const site = await runCrawl(ctx, { maxPages, headless: !options.headed });

        const outputPath = options.output ?? workspace.siteModelPath;
        writeArtifact({
          schema: SiteModelSchema,
          kind: "site-model",
          path: outputPath,
          data: site,
          updateLatest: { workspace, dir: "site-model" },
        });
        logger.info(`Wrote site model: ${outputPath} (${String(site.pages.length)} pages)`);
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
