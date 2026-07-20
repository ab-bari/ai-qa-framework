/**
 * Deterministic scaffold copy (plan §6.4; PHASE_5_GENERATOR_PLAN §1). Copies
 * `templates/generated-project/` to the output dir with trivial `{{token}}`
 * substitution (no Handlebars dependency — a plain string replace covers
 * {{projectName}} / {{baseUrl}}). No LLM. Strips the `.hbs` extension and
 * restores the leading dot on `gitignore` (stored without it so npm packaging
 * does not drop the dotfile).
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** `<packageRoot>/templates/generated-project` — resolves from src (tsx) or dist. */
function templateRoot(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "..", "..", "templates", "generated-project");
}

export interface ScaffoldTokens {
  projectName: string;
  baseUrl: string;
}

/** Map a template file name to its emitted name. */
function outputName(name: string): string {
  if (name === "gitignore") {
    return ".gitignore";
  }
  return name.endsWith(".hbs") ? name.slice(0, -".hbs".length) : name;
}

function substitute(content: string, tokens: ScaffoldTokens): string {
  return content
    .replaceAll("{{projectName}}", tokens.projectName)
    .replaceAll("{{baseUrl}}", tokens.baseUrl);
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

/**
 * Copy the scaffold into `outputDir`, substituting tokens. Returns the emitted
 * files as project-relative POSIX paths (for the manifest). Existing files are
 * overwritten (regeneration is idempotent for the scaffold).
 */
export function scaffoldProject(outputDir: string, tokens: ScaffoldTokens): string[] {
  const root = templateRoot();
  if (!existsSync(root)) {
    throw new Error(`Template scaffold not found at ${root}`);
  }
  const emitted: string[] = [];
  for (const srcFile of walk(root)) {
    const rel = relative(root, srcFile);
    const segments = rel.split(/[\\/]/);
    const lastIndex = segments.length - 1;
    const fileName = segments[lastIndex];
    if (fileName === undefined) {
      continue;
    }
    segments[lastIndex] = outputName(fileName);
    const relOut = segments.join("/");
    const destPath = join(outputDir, ...segments);
    mkdirSync(dirname(destPath), { recursive: true });
    const raw = readFileSync(srcFile, "utf8");
    writeFileSync(destPath, substitute(raw, tokens), "utf8");
    emitted.push(relOut);
  }
  return emitted;
}
