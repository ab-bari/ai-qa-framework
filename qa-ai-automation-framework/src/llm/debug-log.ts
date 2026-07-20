/**
 * Every LLM exchange → `.qa/debug/ai/<ts>-<purpose>/{prompt.md, response.md, meta.json}`
 * (plan §5). Debug logging is unconditional and best-effort — a logging
 * failure must never fail the LLM call itself.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { timestampId } from "../core/ids.js";
import type { Workspace } from "../core/workspace.js";
import type { LlmRequest, LlmResponse } from "./types.js";

export interface DebugLogEntry {
  request: LlmRequest;
  response?: LlmResponse;
  error?: unknown;
  provider: string;
}

function errorToMeta(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, ...(error.stack === undefined ? {} : { stack: error.stack }) };
  }
  return { message: String(error) };
}

/** Writes the exchange to `.qa/debug/ai/`. Swallows and logs its own failures. */
export function writeDebugLog(
  workspace: Workspace,
  entry: DebugLogEntry,
  now: Date = new Date(),
): void {
  try {
    const dirName = `${timestampId(now)}-${entry.request.purpose}`;
    const dir = join(workspace.aiDebugDir, dirName);
    mkdirSync(dir, { recursive: true });

    const promptParts = [`# purpose: ${entry.request.purpose}`, ""];
    if (entry.request.system !== undefined) {
      promptParts.push("## system", "", entry.request.system, "");
    }
    promptParts.push("## prompt", "", entry.request.prompt);
    if (entry.request.imagePaths !== undefined && entry.request.imagePaths.length > 0) {
      promptParts.push("", "## images", ...entry.request.imagePaths.map((p) => `- ${p}`));
    }
    writeFileSync(join(dir, "prompt.md"), `${promptParts.join("\n")}\n`, "utf8");

    const responseParts =
      entry.response !== undefined
        ? [`# response (${String(entry.response.durationMs)}ms)`, "", entry.response.text]
        : entry.error !== undefined
          ? [`# error`, "", errorToMeta(entry.error).message]
          : ["# (no response)"];
    writeFileSync(join(dir, "response.md"), `${responseParts.join("\n")}\n`, "utf8");

    const meta = {
      provider: entry.provider,
      purpose: entry.request.purpose,
      model: entry.request.model ?? "default",
      timestamp: now.toISOString(),
      durationMs: entry.response?.durationMs,
      ok: entry.error === undefined,
      error: entry.error === undefined ? undefined : errorToMeta(entry.error),
    };
    writeFileSync(join(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  } catch {
    // Debug logging is best-effort; never let it fail the actual LLM call.
  }
}
