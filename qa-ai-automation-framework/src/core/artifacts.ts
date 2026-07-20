/**
 * Schema-validated artifact IO (plan §3, §4). Artifacts are the ONLY
 * inter-component API: writers stamp `schema_version` + `generated_by` and
 * update `latest.json` atomically; readers reject major-version mismatches
 * and schema violations with actionable errors.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

import type { z } from "zod";

import { ArtifactError } from "./errors.js";
import { generatedByStamp } from "./version.js";
import { atomicWriteFile, type PointerDir, type Workspace } from "./workspace.js";
import { majorVersion, SCHEMA_VERSIONS, type ArtifactKind } from "../schemas/versions.js";

function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 10)
    .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");
}

export interface WriteArtifactOptions<T> {
  schema: z.ZodType<T>;
  kind: ArtifactKind;
  path: string;
  data: T;
  /** Defaults to `qa-ai@<package version>`. */
  generatedBy?: string;
  /** When set, also update `<dir>/latest.json` to point at this artifact. */
  updateLatest?: { workspace: Workspace; dir: PointerDir };
}

/** Validate, stamp the envelope, and atomically write an artifact. Returns the path. */
export function writeArtifact<T>(options: WriteArtifactOptions<T>): string {
  const parsed = options.schema.safeParse(options.data);
  if (!parsed.success) {
    throw new ArtifactError(
      `Refusing to write invalid ${options.kind} artifact:\n${formatZodIssues(parsed.error)}`,
      {
        remediation:
          "This is a bug in the producing component — re-run with --verbose and report it.",
      },
    );
  }
  const stamped = {
    ...(parsed.data as Record<string, unknown>),
    schema_version: SCHEMA_VERSIONS[options.kind],
    generated_by: options.generatedBy ?? generatedByStamp(),
  };
  mkdirSync(dirname(options.path), { recursive: true });
  atomicWriteFile(options.path, `${JSON.stringify(stamped, null, 2)}\n`);
  options.updateLatest?.workspace.writeLatestPointer(options.updateLatest.dir, options.path);
  return options.path;
}

/** Read and validate an artifact, rejecting schema and major-version mismatches. */
export function readArtifact<T>(schema: z.ZodType<T>, path: string, kind?: ArtifactKind): T {
  if (!existsSync(path)) {
    throw new ArtifactError(`Artifact not found: ${path}`, {
      remediation: "Run the producing command first, or pass --input with an explicit path.",
    });
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new ArtifactError(`Artifact is not valid JSON: ${path}`, { cause });
  }
  if (kind !== undefined && typeof raw === "object" && raw !== null) {
    const declared = (raw as { schema_version?: unknown }).schema_version;
    if (typeof declared === "string") {
      const expected = SCHEMA_VERSIONS[kind];
      if (majorVersion(declared) !== majorVersion(expected)) {
        throw new ArtifactError(
          `Schema version mismatch for ${kind} artifact ${path}: file has ${declared}, this build expects ${expected}.`,
          { remediation: "Regenerate the artifact with this version of qa-ai." },
        );
      }
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new ArtifactError(
      `Artifact failed ${kind ?? "schema"} validation: ${path}\n${formatZodIssues(parsed.error)}`,
      { remediation: "Regenerate the artifact with the producing command." },
    );
  }
  return parsed.data;
}

export interface ResolveArtifactPathOptions {
  /** Explicit --input/--plan/… flag value; wins when provided. */
  explicitPath?: string | undefined;
  workspace: Workspace;
  /** Workspace subdirectory whose latest.json pointer is consulted. */
  latestDir: PointerDir;
  /** Human name of the artifact, e.g. "test plan". */
  artifactName: string;
  /** Command that produces it, e.g. "qa-ai plan". */
  producingCommand: string;
}

/**
 * Artifact discovery (plan §4): explicit flag → latest.json pointer → error
 * naming the prerequisite command.
 */
export function resolveArtifactPath(options: ResolveArtifactPathOptions): string {
  if (options.explicitPath !== undefined) {
    return options.explicitPath;
  }
  const pointed = options.workspace.readLatestPointer(options.latestDir);
  if (pointed !== null && existsSync(pointed)) {
    return pointed;
  }
  throw new ArtifactError(
    `No ${options.artifactName} found. Run '${options.producingCommand}' or pass an explicit path flag. (workspace: ${options.workspace.root})`,
    { remediation: `Run '${options.producingCommand}' first, or pass an explicit path flag.` },
  );
}
