/**
 * JSON-mode pipeline (plan §5): append a schema-guided JSON instruction →
 * extract the last fenced ```json block (or the largest balanced `{...}`) →
 * detect truncation (retryable) → `safeParse` → on failure ONE schema-guided
 * repair round-trip (send the invalid JSON + Zod error paths back) → still
 * failing → `LlmJsonError` so callers can fall back deterministically.
 *
 * Regex/brace-matching here is a parsing aid around the primary strategy
 * (the schema-guided repair round-trip), never a substitute for it — the
 * anti-pattern the plan calls out is treating string "repair" as primary.
 */

import { z } from "zod";

import { LlmError } from "../core/errors.js";
import { TransientLlmError } from "./retry.js";
import type { LlmRequest, LlmResponse } from "./types.js";

export class LlmJsonError extends LlmError {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, {
      remediation: "The caller should fall back to a deterministic default.",
      ...options,
    });
  }
}

function jsonInstruction(schema: z.ZodType): string {
  const jsonSchema = z.toJSONSchema(schema, { target: "draft-7" });
  return [
    "",
    "Respond with ONLY a JSON object in a ```json fence — no prose before or after the fence.",
    "The JSON must validate against this schema:",
    "```json",
    JSON.stringify(jsonSchema, null, 2),
    "```",
  ].join("\n");
}

/** Last fenced ```json ... ``` block in the text, if any. */
function extractFencedJson(text: string): string | null {
  const fenceRe = /```(?:json)?\s*([\s\S]*?)```/gi;
  let last: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(text)) !== null) {
    const body = match[1];
    if (body !== undefined) {
      last = body.trim();
    }
  }
  return last;
}

/** The largest balanced `{...}` span in the text, scanning for the earliest `{` that closes cleanly. */
function extractLargestBalancedObject(text: string): string | null {
  let best: string | null = null;
  for (let start = text.indexOf("{"); start !== -1; start = text.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          if (best === null || candidate.length > best.length) {
            best = candidate;
          }
          break;
        }
      }
    }
  }
  return best;
}

/** Best-effort JSON candidate extraction: fenced block first, then largest balanced object. */
export function extractJsonCandidate(text: string): string | null {
  return extractFencedJson(text) ?? extractLargestBalancedObject(text);
}

/**
 * A response looks truncated when it has an opening `{` or a ```json fence
 * but no matching close — i.e. the model was cut off mid-generation.
 */
export function looksTruncated(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") {
    return false;
  }
  const openFences = (trimmed.match(/```/g) ?? []).length;
  if (openFences % 2 === 1) {
    return true;
  }
  const firstBrace = trimmed.indexOf("{");
  if (firstBrace === -1) {
    return false;
  }
  return extractLargestBalancedObject(trimmed) === null;
}

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export interface CompleteJsonDeps {
  /** The provider's own `complete` — json-mode drives it, never replaces it. */
  complete: (req: LlmRequest) => Promise<LlmResponse>;
}

/**
 * Shared completeJson pipeline used by every LLMProvider implementation, so
 * "how JSON mode works" lives in exactly one place (plan §5).
 */
export async function completeJson<T>(
  deps: CompleteJsonDeps,
  req: LlmRequest,
  schema: z.ZodType<T>,
): Promise<T> {
  const augmentedReq: LlmRequest = { ...req, prompt: req.prompt + jsonInstruction(schema) };
  const first = await deps.complete(augmentedReq);

  const firstCandidate = extractJsonCandidate(first.text);
  if (firstCandidate === null && looksTruncated(first.text)) {
    throw new TransientLlmError(
      "truncation",
      `${req.purpose}: response appears truncated (no closing brace/fence found)`,
    );
  }

  const firstParsed = schema.safeParse(
    firstCandidate === null ? tryParse(first.text) : tryParse(firstCandidate),
  );
  if (firstParsed.success) {
    return firstParsed.data;
  }

  // One schema-guided repair round-trip: send back what we got + why it's wrong.
  const invalidJson = firstCandidate ?? first.text;
  const issues =
    firstParsed.error instanceof z.ZodError
      ? formatZodIssues(firstParsed.error)
      : "  - (response was not valid JSON)";
  const repairPrompt = [
    "The previous response did not match the required schema.",
    "",
    "Previous response:",
    "```json",
    invalidJson,
    "```",
    "",
    "Validation errors:",
    issues,
    "",
    "Respond again with ONLY a corrected JSON object in a ```json fence that fixes every listed error.",
  ].join("\n");

  const repair = await deps.complete({ ...req, prompt: repairPrompt });
  const repairCandidate = extractJsonCandidate(repair.text);
  const repairParsed = schema.safeParse(
    repairCandidate === null ? tryParse(repair.text) : tryParse(repairCandidate),
  );
  if (repairParsed.success) {
    return repairParsed.data;
  }

  throw new LlmJsonError(
    `${req.purpose}: response failed schema validation after one repair round-trip:\n${formatZodIssues(
      repairParsed.error instanceof z.ZodError ? repairParsed.error : new z.ZodError([]),
    )}`,
  );
}

function tryParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
