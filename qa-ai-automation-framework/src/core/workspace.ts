/**
 * `.qa/` workspace path resolution and `latest.json` pointer discovery
 * (plan §3 workspace layout, §4 artifact discovery).
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { ArtifactError } from "./errors.js";

/** Workspace subdirectories that maintain a `latest.json` pointer. */
export type PointerDir = "site-model" | "plans" | "runs" | "automation-runs" | "healing";

export class Workspace {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  resolve(...segments: string[]): string {
    return join(this.root, ...segments);
  }

  /** Create (if needed) and return an absolute directory path inside the workspace. */
  ensureDir(...segments: string[]): string {
    const dir = this.resolve(...segments);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  // Well-known locations (plan §3 workspace layout).
  get siteModelDir(): string {
    return this.resolve("site-model");
  }
  get siteModelPath(): string {
    return this.resolve("site-model", "site-model.json");
  }
  get plansDir(): string {
    return this.resolve("plans");
  }
  get runsDir(): string {
    return this.resolve("runs");
  }
  get coverageRegistryPath(): string {
    return this.resolve("coverage", "coverage-registry.json");
  }
  get storageStatePath(): string {
    return this.resolve("auth", "storage-state.json");
  }
  get generatedTestsDir(): string {
    return this.resolve("generated-tests");
  }
  get automationRunsDir(): string {
    return this.resolve("automation-runs");
  }
  get healingDir(): string {
    return this.resolve("healing");
  }
  get aiDebugDir(): string {
    return this.resolve("debug", "ai");
  }

  /**
   * Read the `latest.json` pointer of a workspace subdirectory. Returns the
   * absolute path of the artifact it points to, or null when no pointer exists.
   */
  readLatestPointer(dir: PointerDir): string | null {
    const pointerPath = this.resolve(dir, "latest.json");
    if (!existsSync(pointerPath)) {
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(pointerPath, "utf8"));
    } catch (cause) {
      throw new ArtifactError(`Corrupt latest.json pointer: ${pointerPath}`, {
        remediation: `Delete ${pointerPath} and re-run the producing command.`,
        cause,
      });
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { path?: unknown }).path !== "string"
    ) {
      throw new ArtifactError(
        `Invalid latest.json pointer (expected {"path": string}): ${pointerPath}`,
        {
          remediation: `Delete ${pointerPath} and re-run the producing command.`,
        },
      );
    }
    const pointed = (parsed as { path: string }).path;
    return isAbsolute(pointed) ? pointed : this.resolve(pointed);
  }

  /**
   * Atomically update the `latest.json` pointer of a subdirectory to reference
   * `artifactPath` (stored relative to the workspace root).
   */
  writeLatestPointer(dir: PointerDir, artifactPath: string): void {
    const dirPath = this.ensureDir(dir);
    const relPath = relative(this.root, resolve(artifactPath)).replaceAll("\\", "/");
    const pointerPath = join(dirPath, "latest.json");
    atomicWriteFile(pointerPath, `${JSON.stringify({ path: relPath }, null, 2)}\n`);
  }
}

/** Write via temp file + rename so readers never observe a partial file. */
export function atomicWriteFile(path: string, content: string): void {
  const tempPath = `${path}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tempPath, content, "utf8");
  renameSync(tempPath, path);
}

export interface WorkspaceRootOptions {
  /** `--workspace` CLI flag — highest precedence. */
  cliWorkspace?: string | undefined;
  /** `workspace_dir` from config — middle precedence. */
  configWorkspaceDir?: string | undefined;
  /** Base for relative paths; defaults to process.cwd(). */
  cwd?: string | undefined;
}

export function createWorkspace(options: WorkspaceRootOptions = {}): Workspace {
  const cwd = options.cwd ?? process.cwd();
  const dir = options.cliWorkspace ?? options.configWorkspaceDir ?? ".qa";
  return new Workspace(isAbsolute(dir) ? dir : resolve(cwd, dir));
}
