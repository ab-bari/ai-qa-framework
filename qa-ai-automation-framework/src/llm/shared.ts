/**
 * Small helpers shared by both providers: model-slot resolution, the vision
 * prompt-augmentation convention, and auth-error string detection.
 */

import type { LlmRequest } from "./types.js";

/**
 * Resolve the `"default" | "fast"` slot to a concrete model name.
 * "default" uses the configured model (empty → let the provider pick);
 * "fast" always maps to a quick, cheap model.
 */
export function resolveModel(
  slot: "default" | "fast" | undefined,
  configuredModel: string,
): string | undefined {
  if (slot === "fast") {
    return "haiku";
  }
  return configuredModel === "" ? undefined : configuredModel;
}

/**
 * Vision convention (plan §5): reference the screenshot's absolute path in the
 * prompt and let the model Read it — the Read tool is the only tool allowed on
 * these calls.
 */
export function withImagePrompt(req: LlmRequest): string {
  if (req.imagePaths === undefined || req.imagePaths.length === 0) {
    return req.prompt;
  }
  const lines = req.imagePaths.map((p) => `- ${p}`);
  return [
    req.prompt,
    "",
    "Read and examine the following screenshot file(s) using the Read tool:",
    ...lines,
  ].join("\n");
}

const AUTH_ERROR_RE =
  /(please )?run\s+`?claude(\s+\/?login)?`?|not (logged in|authenticated)|authentication[_ ]failed|invalid api key|no api key|credit balance|log ?in to claude/i;

/** Heuristic: does this provider output/error indicate the user isn't authenticated? */
export function looksLikeAuthError(text: string): boolean {
  return AUTH_ERROR_RE.test(text);
}
