/**
 * Hidden debug command (plan §9): drive the configured LLM provider directly.
 * Used to manually verify JSON round-trips and screenshot-describe against a
 * real local Claude Code. Not shown in `qa-ai --help`.
 */

import { resolve } from "node:path";

import type { Command } from "commander";
import { z } from "zod";

import { loadConfig } from "../../core/config/load-config.js";
import { createWorkspace } from "../../core/workspace.js";
import { createProvider } from "../../llm/factory.js";
import type { LlmRequest } from "../../llm/types.js";
import { globalOptions } from "../global-options.js";
import { handleFatalError } from "../format-error.js";

const EchoJsonSchema = z.object({
  echo: z.string(),
  word_count: z.number().int().min(0),
});

interface AiEchoOptions {
  prompt: string;
  json: boolean;
  image?: string;
  fast: boolean;
}

export function registerAiEchoCommand(program: Command): void {
  program
    .command("ai-echo", { hidden: true })
    .description("(debug) send a prompt to the configured LLM provider and print the response")
    .option("--prompt <text>", "prompt to send", "Reply with exactly the word: pong")
    .option("--json", "exercise completeJson with a small {echo, word_count} schema", false)
    .option("--image <path>", "attach a screenshot (vision; only the Read tool is permitted)")
    .option("--fast", "use the provider's fast model slot", false)
    .action(async (options: AiEchoOptions, command: Command) => {
      const globals = globalOptions(command);
      try {
        const config = loadConfig(globals.config);
        const workspace = createWorkspace({
          cliWorkspace: globals.workspace,
          configWorkspaceDir: config.workspace_dir,
        });
        const provider = createProvider(config, { workspace });

        const req: LlmRequest = {
          purpose: "echo",
          prompt: options.prompt,
          model: options.fast ? "fast" : "default",
          ...(options.image === undefined ? {} : { imagePaths: [resolve(options.image)] }),
        };

        console.log(`provider: ${provider.name}`);
        if (options.json) {
          const result = await provider.completeJson(
            { ...req, prompt: `${options.prompt}\nReturn the echoed text and its word count.` },
            EchoJsonSchema,
          );
          console.log(JSON.stringify(result, null, 2));
        } else {
          const response = await provider.complete(req);
          console.log(`(${String(response.durationMs)}ms)\n${response.text}`);
        }
      } catch (error) {
        handleFatalError(error, globals.verbose === true);
      }
    });
}
