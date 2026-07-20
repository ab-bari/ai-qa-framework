/**
 * DEFAULT provider: the Claude Agent SDK driving the locally installed,
 * subscription-authenticated Claude Code (plan §5). No API key — the SDK uses
 * the local `claude login` credentials when ANTHROPIC_API_KEY is unset.
 *
 * Only the Read tool is ever permitted, and only on vision calls; every other
 * tool request is denied via `canUseTool` so unattended runs never hang.
 */

import {
  query,
  type Options,
  type PermissionResult,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";

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

/** Assistant-message error codes that are transient (worth retrying). */
const TRANSIENT_ASSISTANT_ERRORS = new Set(["rate_limit", "overloaded", "server_error"]);
const AUTH_ASSISTANT_ERRORS = new Set(["authentication_failed", "oauth_org_not_allowed"]);

export class ClaudeCodeProvider extends BaseLlmProvider {
  readonly name = "claude-code";
  private readonly configuredModel: string;

  constructor(options: { configuredModel: string; workspace?: Workspace }) {
    super(options.workspace);
    this.configuredModel = options.configuredModel;
  }

  protected async rawComplete(req: LlmRequest): Promise<LlmResponse> {
    const wantsVision = req.imagePaths !== undefined && req.imagePaths.length > 0;
    const abortController = new AbortController();
    const timeoutMs = timeoutForPurpose(req.purpose, req.timeoutMs);
    // We only ever abort on timeout, so signal.aborted implies a timeout below.
    const timer = setTimeout(() => {
      abortController.abort();
    }, timeoutMs);

    const model = resolveModel(req.model, this.configuredModel);
    const options: Options = {
      abortController,
      // Read is the only tool we ever allow, and only for vision; deny the rest.
      allowedTools: wantsVision ? ["Read"] : [],
      permissionMode: "default",
      canUseTool: (toolName: string): Promise<PermissionResult> => {
        if (wantsVision && toolName === "Read") {
          return Promise.resolve({ behavior: "allow", updatedInput: {} });
        }
        return Promise.resolve({
          behavior: "deny",
          message: `qa-ai only permits the Read tool; denied ${toolName}.`,
        });
      },
      // Vision needs a couple of turns (Read → answer); text is single-turn.
      maxTurns: wantsVision ? 4 : 1,
      // Don't load the user's CLAUDE.md / hooks / MCP — keep prompts deterministic.
      settingSources: [],
      ...(model === undefined ? {} : { model }),
      // A plain string system prompt replaces the Claude Code coding preset.
      systemPrompt:
        req.system ?? "You are a precise assistant. Follow the user's instructions exactly.",
    };

    const start = Date.now();
    let assistantText = "";
    let resultText: string | null = null;

    try {
      for await (const message of query({ prompt: withImagePrompt(req), options })) {
        this.handleMessage(message, (text) => {
          assistantText += text;
        });
        if (message.type === "result") {
          resultText = message.subtype === "success" ? message.result : null;
          if (message.subtype !== "success") {
            throw new TransientLlmError(
              "transient-stderr",
              `claude-code result ${message.subtype}: ${message.errors.join("; ") || "(no detail)"}`,
            );
          }
        }
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        throw new TransientLlmError(
          "timeout",
          `claude-code timed out after ${String(timeoutMs)}ms`,
        );
      }
      throw this.classifyError(error);
    } finally {
      clearTimeout(timer);
    }

    const text = (resultText ?? assistantText).trim();
    if (text === "") {
      throw new TransientLlmError("transient-stderr", "claude-code returned no text");
    }
    return { text, durationMs: Date.now() - start };
  }

  /** Accumulate assistant text and raise auth/transient errors surfaced on assistant messages. */
  private handleMessage(message: SDKMessage, onText: (text: string) => void): void {
    if (message.type !== "assistant") {
      return;
    }
    if (message.error !== undefined) {
      if (AUTH_ASSISTANT_ERRORS.has(message.error)) {
        throw new AuthLlmError(`claude-code assistant error: ${message.error}`);
      }
      if (TRANSIENT_ASSISTANT_ERRORS.has(message.error)) {
        throw new TransientLlmError(
          "transient-stderr",
          `claude-code assistant error: ${message.error}`,
        );
      }
    }
    const content: unknown = message.message.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string"
        ) {
          onText((block as { text: string }).text);
        }
      }
    }
  }

  private classifyError(error: unknown): Error {
    if (error instanceof TransientLlmError || error instanceof AuthLlmError) {
      return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    if (looksLikeAuthError(message)) {
      return new AuthLlmError(message, { cause: error });
    }
    return new TransientLlmError("transient-stderr", message, { cause: error });
  }

  async healthCheck(): Promise<LlmHealthCheck> {
    try {
      const response = await this.rawComplete({
        purpose: "echo",
        prompt: "Reply with exactly the word: pong",
        timeoutMs: 60_000,
      });
      return { ok: true, detail: `claude-code responded (${String(response.durationMs)}ms)` };
    } catch (error) {
      if (error instanceof AuthLlmError) {
        return { ok: false, detail: "not authenticated — run `claude login`" };
      }
      return { ok: false, detail: error instanceof Error ? error.message : String(error) };
    }
  }
}
