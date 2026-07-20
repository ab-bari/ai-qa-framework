/**
 * Coverage registry IO (plan §6.2, §3). Phase 3 needs only the READ path: load
 * an existing registry, or synthesize an empty one so the planner can run on a
 * first pass with no history. The write path (updating signatures after a run)
 * arrives with the executor in Phase 4.
 *
 * Shared read infrastructure (src/coverage) — importable by any component.
 */

import { existsSync } from "node:fs";

import { readArtifact } from "../core/artifacts.js";
import { CoverageRegistrySchema, type CoverageRegistry } from "../schemas/coverage.js";

/** An empty registry for a target URL — every page reads as untested. */
export function emptyRegistry(targetUrl: string): CoverageRegistry {
  return CoverageRegistrySchema.parse({ target_url: targetUrl });
}

/**
 * Load the coverage registry from `path` when it exists (schema-validated),
 * otherwise return an empty registry for `targetUrl`. A missing registry is a
 * normal first-run condition, never an error.
 */
export function loadCoverageRegistry(path: string, targetUrl: string): CoverageRegistry {
  if (!existsSync(path)) {
    return emptyRegistry(targetUrl);
  }
  return readArtifact(CoverageRegistrySchema, path, "coverage-registry");
}
