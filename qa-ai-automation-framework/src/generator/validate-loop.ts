/**
 * Validation loop (plan §6.4; PHASE_5_GENERATOR_PLAN §4). After files are
 * written: `npm install` → `npx tsc --noEmit` → `npx playwright test --list`,
 * feeding failures back to the LLM (max 3 repair rounds per stage) → static
 * convention lint. `--skip-validate` bypasses the npm/tsc/list steps; the lint
 * always runs. Returns the repair-round count and any lint violations so the
 * manifest records them.
 */

import { spawn } from "node:child_process";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import type { RunContext } from "../core/run-context.js";
import { lintGeneratedFiles, type LintViolation } from "./conventions.js";
import { GeneratedFilesSchema } from "./prompts.js";

export interface GenFile {
  path: string;
  content: string;
}

export interface ValidationResult {
  repairRounds: number;
  lintViolations: LintViolation[];
  /** Files after any repair rewrites — the source of truth for the manifest. */
  files: GenFile[];
  /** True when npm/tsc/list actually ran (false when skipped or install failed). */
  validated: boolean;
}

const MAX_REPAIR_ROUNDS = 3;

interface CmdResult {
  code: number | null;
  stdout: string;
  stderr: string;
  spawnError: NodeJS.ErrnoException | null;
}

function runCommand(command: string, args: string[], cwd: string): Promise<CmdResult> {
  return new Promise<CmdResult>((resolvePromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let spawnError: NodeJS.ErrnoException | null = null;
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString("utf8")));
    child.on("error", (e: NodeJS.ErrnoException) => (spawnError = e));
    child.on("close", (code) => {
      resolvePromise({ code, stdout, stderr, spawnError });
    });
  });
}

/** Write a generated file, guarding against escaping the project directory. */
function writeInProject(projectDir: string, file: GenFile): void {
  const dest = resolve(projectDir, file.path);
  if (relative(projectDir, dest).startsWith("..")) {
    throw new Error(`Refusing to write outside the project: ${file.path}`);
  }
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, file.content, "utf8");
}

function buildRepairPrompt(stage: string, output: string, files: readonly GenFile[]): string {
  const fileBlocks = files
    .map((f) => `### ${f.path}\n\`\`\`typescript\n${f.content}\n\`\`\``)
    .join("\n\n");
  return [
    `The generated Playwright project fails \`${stage}\`. Fix the offending files.`,
    ``,
    `## ${stage} output`,
    "```",
    output.slice(0, 8000),
    "```",
    ``,
    `## Current generated files`,
    fileBlocks,
    ``,
    `## Rules`,
    `- Keep the same conventions (imports from the fixtures barrel in specs, getBy* locators, no waitForTimeout).`,
    `- Return ONLY the files that must change, as \`{ "files": [ { "path", "content" } ] }\`, with each file's COMPLETE new content.`,
    `- Do not delete tests or weaken assertions to make it compile.`,
  ].join("\n");
}

/** Merge repaired files into the tracked set (replace by path, append new). */
function mergeFiles(current: GenFile[], repaired: readonly GenFile[]): GenFile[] {
  const byPath = new Map(current.map((f) => [f.path, f]));
  for (const file of repaired) {
    byPath.set(file.path, file);
  }
  return [...byPath.values()];
}

/**
 * Run one repair-driven stage: execute `command`, and while it fails and
 * rounds remain, ask the LLM to fix the generated files and rewrite them.
 * Returns the updated file set and the number of repair rounds spent.
 */
async function repairStage(
  ctx: RunContext,
  stage: string,
  command: string,
  args: string[],
  projectDir: string,
  files: GenFile[],
): Promise<{ files: GenFile[]; rounds: number; ok: boolean }> {
  const { logger } = ctx;
  let current = files;
  for (let round = 0; round <= MAX_REPAIR_ROUNDS; round++) {
    const result = await runCommand(command, args, projectDir);
    if (result.spawnError !== null) {
      logger.warn(`${stage}: could not run (${result.spawnError.message}) — skipping this stage.`);
      return { files: current, rounds: round, ok: false };
    }
    if (result.code === 0) {
      if (round > 0) {
        logger.info(`${stage}: passed after ${String(round)} repair round(s).`);
      } else {
        logger.info(`${stage}: passed.`);
      }
      return { files: current, rounds: round, ok: true };
    }
    if (round === MAX_REPAIR_ROUNDS || ctx.llm === undefined) {
      logger.warn(`${stage}: still failing after ${String(round)} repair round(s).`);
      return { files: current, rounds: round, ok: false };
    }
    const output = `${result.stdout}\n${result.stderr}`.trim();
    logger.info(`${stage}: failed — requesting repair (round ${String(round + 1)}).`);
    try {
      const repaired = await ctx.llm.completeJson(
        { purpose: "generator", prompt: buildRepairPrompt(stage, output, current) },
        GeneratedFilesSchema,
      );
      current = mergeFiles(current, repaired.files);
      for (const file of repaired.files) {
        writeInProject(projectDir, file);
      }
    } catch (error) {
      logger.warn(`${stage}: repair request failed (${String(error)}) — stopping repairs.`);
      return { files: current, rounds: round, ok: false };
    }
  }
  return { files: current, rounds: MAX_REPAIR_ROUNDS, ok: false };
}

export interface RunValidationOptions {
  projectDir: string;
  files: GenFile[];
  skipValidate: boolean;
}

export async function runValidation(
  ctx: RunContext,
  options: RunValidationOptions,
): Promise<ValidationResult> {
  const { logger } = ctx;
  const { projectDir } = options;
  let files = options.files;

  const lint = (): LintViolation[] => {
    const violations = lintGeneratedFiles(files);
    for (const v of violations) {
      logger.warn(`lint ${v.rule} at ${v.file}:${String(v.line)} — ${v.message}`);
    }
    if (violations.length === 0) {
      logger.info("Convention lint: clean.");
    }
    return violations;
  };

  if (options.skipValidate) {
    logger.info("--skip-validate: skipping npm/tsc/--list (lint still runs).");
    return { repairRounds: 0, lintViolations: lint(), files, validated: false };
  }

  logger.info("Installing generated project dependencies (npm install)...");
  const install = await runCommand("npm", ["install"], projectDir);
  if (install.spawnError !== null || install.code !== 0) {
    const detail = install.spawnError?.message ?? install.stderr.trim().slice(0, 500);
    logger.warn(`npm install failed — skipping tsc/--list validation. ${detail}`);
    return { repairRounds: 0, lintViolations: lint(), files, validated: false };
  }

  let repairRounds = 0;

  const tsc = await repairStage(ctx, "tsc --noEmit", "npx", ["tsc", "--noEmit"], projectDir, files);
  files = tsc.files;
  repairRounds += tsc.rounds;

  const list = await repairStage(
    ctx,
    "playwright test --list",
    "npx",
    ["playwright", "test", "--list"],
    projectDir,
    files,
  );
  files = list.files;
  repairRounds += list.rounds;

  return { repairRounds, lintViolations: lint(), files, validated: tsc.ok && list.ok };
}

/** Best-effort check that the generated project has Playwright's browser available. */
export function projectHasNodeModules(projectDir: string): boolean {
  return existsSync(join(projectDir, "node_modules"));
}
