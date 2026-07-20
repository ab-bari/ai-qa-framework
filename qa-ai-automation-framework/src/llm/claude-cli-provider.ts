/**
 * Fallback provider: spawn `claude -p --output-format json` with the prompt
 * piped via STDIN (never argv — Windows has a ~32K argv limit and planner
 * prompts can be tens of KB; plan §5). Uses the same local subscription auth
 * as the Agent SDK.
 */

import { spawn } from "node:child_process";

import { z } from "zod";

import { LlmError } from "../core/errors.js";
import type { Workspace } from "../core/workspace.js";
import { BaseLlmProvider } from "./base-provider.js";
import { AuthLlmError, TransientLlmError } from "./retry.js";
import { looksLikeAuthError, resolveModel, withImagePrompt } from "./shared.js";
import {
  timeoutForPurpose,
  type LlmHealthCheck,
  type LlmRequest,
  type LlmResponse,
} from "./types.js";

/** Minimal schema for `claude -p --output-format json` output (plan §5). */
const CliResultSchema = z.looseObject({
  type: z.string(),
  subtype: z.string().optional(),
  result: z.string().optional(),
  is_error: z.boolean().optional(),
  total_cost_usd: z.number().optional(),
  session_id: z.string().optional(),
  errors: z.array(z.string()).optional(),
});

interface SpawnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  spawnError: NodeJS.ErrnoException | null;
  timedOut: boolean;
}

export class ClaudeCliProvider extends BaseLlmProvider {
  readonly name = "claude-code-cli";
  private readonly configuredModel: string;

  constructor(options: { configuredModel: string; workspace?: Workspace }) {
    super(options.workspace);
    this.configuredModel = options.configuredModel;
  }

  private runClaude(prompt: string, args: string[], timeoutMs: number): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolve) => {
      const child = spawn("claude", args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: process.platform === "win32",
      });
      let stdout = "";
      let stderr = "";
      let spawnError: NodeJS.ErrnoException | null = null;
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 2_000);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", (error: NodeJS.ErrnoException) => {
        spawnError = error;
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code, spawnError, timedOut });
      });

      child.stdin.on("error", () => {
        // stdin may close early if claude fails to launch; the close handler reports it.
      });
      child.stdin.end(prompt, "utf8");
    });
  }

  protected async rawComplete(req: LlmRequest): Promise<LlmResponse> {
    const wantsVision = req.imagePaths !== undefined && req.imagePaths.length > 0;
    const model = resolveModel(req.model, this.configuredModel);
    const timeoutMs = timeoutForPurpose(req.purpose, req.timeoutMs);

    const args = ["-p", "--output-format", "json", "--max-turns", wantsVision ? "4" : "1"];
    if (model !== undefined) {
      args.push("--model", model);
    }
    if (req.system !== undefined) {
      args.push("--append-system-prompt", req.system);
    }
    if (wantsVision) {
      args.push("--allowedTools", "Read");
    }

    const start = Date.now();
    const result = await this.runClaude(withImagePrompt(req), args, timeoutMs);

    if (result.spawnError !== null) {
      if (result.spawnError.code === "ENOENT") {
        throw new LlmError("claude CLI not found on PATH", {
          remediation:
            "Install Claude Code (https://claude.com/claude-code) and ensure `claude` is on PATH.",
          cause: result.spawnError,
        });
      }
      throw new TransientLlmError("spawn-failure", result.spawnError.message, {
        cause: result.spawnError,
      });
    }
    if (result.timedOut) {
      throw new TransientLlmError("timeout", `claude CLI timed out after ${String(timeoutMs)}ms`);
    }

    const combined = `${result.stdout}\n${result.stderr}`;
    if (looksLikeAuthError(combined)) {
      throw new AuthLlmError("claude CLI reports it is not authenticated");
    }
    if (result.code !== 0) {
      throw new TransientLlmError(
        "transient-stderr",
        `claude CLI exited ${String(result.code)}: ${result.stderr.trim() || "(no stderr)"}`,
      );
    }

    const text = this.parseResult(result.stdout, req.purpose);
    return { text, durationMs: Date.now() - start };
  }

  private parseResult(stdout: string, purpose: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout.trim());
    } catch {
      throw new TransientLlmError("truncation", `${purpose}: claude CLI output was not valid JSON`);
    }
    const result = CliResultSchema.safeParse(parsed);
    if (!result.success) {
      throw new TransientLlmError(
        "transient-stderr",
        `${purpose}: unexpected claude CLI JSON shape`,
      );
    }
    const data = result.data;
    if (data.is_error === true || (data.subtype !== undefined && data.subtype !== "success")) {
      const detail = data.errors?.join("; ") ?? data.subtype ?? "unknown error";
      throw new TransientLlmError("transient-stderr", `${purpose}: claude CLI error: ${detail}`);
    }
    const text = (data.result ?? "").trim();
    if (text === "") {
      throw new TransientLlmError(
        "transient-stderr",
        `${purpose}: claude CLI returned no result text`,
      );
    }
    return text;
  }

  async healthCheck(): Promise<LlmHealthCheck> {
    try {
      const response = await this.rawComplete({
        purpose: "echo",
        prompt: "Reply with exactly the word: pong",
        timeoutMs: 60_000,
      });
      return { ok: true, detail: `claude CLI responded (${String(response.durationMs)}ms)` };
    } catch (error) {
      if (error instanceof AuthLlmError) {
        return { ok: false, detail: "not authenticated — run `claude login`" };
      }
      if (error instanceof LlmError) {
        return { ok: false, detail: error.message };
      }
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
