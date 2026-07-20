/**
 * Generation manifest artifact (plan §4, §6.4; PHASE_5_GENERATOR_PLAN §5).
 * Emitted to `automation-tests/generation-manifest.json` so it travels with
 * the generated project — the Phase 6 runner and Phase 7 healer consume it
 * (alongside the `// qa-ai:test_id=…` traceability comments) to map spec files
 * back to their source TestCase ids.
 */

import { z } from "zod";

import { artifactEnvelope } from "./versions.js";

/** What a generated file is, so consumers can reason about it without re-parsing. */
export const GeneratedFileKindSchema = z.enum(["page-object", "spec", "data", "scaffold"]);
export type GeneratedFileKind = z.infer<typeof GeneratedFileKindSchema>;

export const GeneratedFileSchema = z.object({
  /** Project-relative POSIX path, e.g. "tests/auth/login.spec.ts". */
  path: z.string(),
  kind: GeneratedFileKindSchema,
  /** Source TestCase ids this file covers (empty for scaffold/page-object/data). */
  test_ids: z.array(z.string()).default([]),
});
export type GeneratedFile = z.infer<typeof GeneratedFileSchema>;

export const GenerationManifestSchema = z.object({
  ...artifactEnvelope,
  plan_id: z.string(),
  /** Path to the SiteModel the locators were derived from. */
  site_model: z.string().default(""),
  target_url: z.string(),
  /** Absolute path of the emitted standalone project. */
  project_dir: z.string(),
  files: z.array(GeneratedFileSchema).default([]),
  /** tsc/--list repair rounds spent during the validation loop. */
  repair_rounds: z.number().int().min(0).default(0),
  /** Convention-lint violations recorded but not fatal (regex heuristics). */
  lint_warnings: z.array(z.string()).default([]),
  generated_at: z.string(),
});
export type GenerationManifest = z.infer<typeof GenerationManifestSchema>;
