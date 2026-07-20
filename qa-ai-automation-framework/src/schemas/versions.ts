/**
 * Schema versions stamped into every top-level artifact (plan §4).
 * `readArtifact` rejects major-version mismatches with a clear error.
 */

import { z } from "zod";

export const SCHEMA_VERSIONS = {
  "site-model": "1.0.0",
  "test-plan": "1.0.0",
  "run-result": "1.0.0",
  "coverage-registry": "1.0.0",
  "healing-report": "1.0.0",
  // Reserved for Phase 5 (generator output manifest).
  "generation-manifest": "1.0.0",
} as const;

export type ArtifactKind = keyof typeof SCHEMA_VERSIONS;

export function majorVersion(version: string): number {
  const major = Number.parseInt(version.split(".")[0] ?? "", 10);
  return Number.isNaN(major) ? -1 : major;
}

/**
 * Envelope fields present on every top-level artifact. Optional in the schema
 * because `writeArtifact` stamps them at write time.
 */
export const artifactEnvelope = {
  schema_version: z.string().optional(),
  generated_by: z.string().optional(),
};
