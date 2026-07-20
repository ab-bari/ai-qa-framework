/**
 * Generator orchestrator (plan §6.4; PHASE_5_GENERATOR_PLAN §2, §6). Resolve
 * inputs → scaffold → generate one Page Object per targeted SiteModel page →
 * generate specs per feature group (test cases sharing a target_page_id) →
 * write files + `.env.example` → run the validation loop → emit
 * `generation-manifest.json`. Inputs are TestPlan + SiteModel only (no
 * RunResult); output is a self-contained standalone project.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { writeArtifact } from "../core/artifacts.js";
import type { RunContext } from "../core/run-context.js";
import type { GeneratedFile, GenerationManifest } from "../schemas/generation-manifest.js";
import { GenerationManifestSchema } from "../schemas/generation-manifest.js";
import type { PageModel, SiteModel } from "../schemas/site-model.js";
import type { TestCase, TestPlan } from "../schemas/test-plan.js";
import type { LintViolation } from "./conventions.js";
import { generatePageObject } from "./page-object-generator.js";
import { scaffoldProject } from "./scaffold.js";
import {
  collectEnvVars,
  extractTraceabilityIds,
  generateSpecs,
  type FeatureGroup,
} from "./spec-generator.js";
import { runValidation, type GenFile } from "./validate-loop.js";

export interface GenerateOptions {
  /** Absolute output directory (default: the workspace's automationTestsDir). */
  outputDir: string;
  /** Path to the SiteModel, recorded in the manifest. */
  siteModelPath?: string | undefined;
  /** Bypass npm/tsc/--list (lint still runs). */
  skipValidate?: boolean | undefined;
}

export interface GenerateResult {
  projectDir: string;
  fileCount: number;
  pageObjectCount: number;
  specCount: number;
  repairRounds: number;
  lintViolations: LintViolation[];
  manifestPath: string;
}

/** Slug for the generated project's package name, e.g. "www.saucedemo.com" → "saucedemo-tests". */
function projectNameFromUrl(baseUrl: string): string {
  let host = baseUrl;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    /* keep raw */
  }
  const core = host
    .replace(/^www\./, "")
    .replace(/\.[a-z]+$/i, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `${core || "site"}-tests`;
}

/** Group test cases by target_page_id, preserving first-seen order. */
function groupByPage(testCases: readonly TestCase[]): Map<string, TestCase[]> {
  const groups = new Map<string, TestCase[]>();
  for (const tc of testCases) {
    const key = tc.target_page_id;
    const bucket = groups.get(key) ?? [];
    bucket.push(tc);
    groups.set(key, bucket);
  }
  return groups;
}

function classifyKind(path: string): GeneratedFile["kind"] {
  if (/(^|\/)src\/pages\//.test(path)) {
    return "page-object";
  }
  if (/(^|\/)tests\/data\//.test(path) && path.endsWith(".json")) {
    return "data";
  }
  if (path.endsWith(".spec.ts") || path.endsWith(".test.ts")) {
    return "spec";
  }
  return "data";
}

/** Human-friendly group name from the page (title → url → id). */
function groupName(page: PageModel | undefined, key: string): string {
  if (page === undefined) {
    return key === "" ? "General" : key;
  }
  return page.title || page.url || page.page_id;
}

export async function runGenerate(
  ctx: RunContext,
  plan: TestPlan,
  siteModel: SiteModel,
  options: GenerateOptions,
): Promise<GenerateResult> {
  const { logger } = ctx;
  const projectDir = resolve(options.outputDir);
  const baseUrl = siteModel.base_url || ctx.config.target_url;

  if (plan.test_cases.length === 0) {
    throw new Error(
      "The TestPlan has no test cases — nothing to generate. Run 'qa-ai plan' first.",
    );
  }

  // 1. Deterministic scaffold.
  logger.info(`Scaffolding standalone project at ${projectDir}`);
  const scaffoldFiles = scaffoldProject(projectDir, {
    projectName: projectNameFromUrl(baseUrl),
    baseUrl,
  });

  const pagesById = new Map(siteModel.pages.map((p) => [p.page_id, p]));
  const groups = groupByPage(plan.test_cases);

  // 2. Page objects — one call per targeted page that exists in the SiteModel.
  const generated: GenFile[] = [];
  const poSourceByPage = new Map<string, string>();
  let pageObjectCount = 0;
  for (const [pageId] of groups) {
    const page = pagesById.get(pageId);
    if (page === undefined) {
      continue;
    }
    logger.info(`Generating page object for page ${pageId} (${page.url})`);
    const result = await generatePageObject(ctx, page, baseUrl);
    const sources: string[] = [];
    for (const file of result.files) {
      generated.push(file);
      sources.push(file.content);
      pageObjectCount++;
    }
    poSourceByPage.set(pageId, sources.join("\n\n"));
  }

  // 3. Specs — one call per feature group.
  const specTestIdsByPath = new Map<string, string[]>();
  let specCount = 0;
  for (const [pageId, testCases] of groups) {
    const page = pagesById.get(pageId);
    const group: FeatureGroup = {
      name: groupName(page, pageId),
      targetPageId: pageId,
      testCases,
      pageObjectsSource: poSourceByPage.get(pageId) ?? "",
    };
    logger.info(`Generating specs for group "${group.name}" (${String(testCases.length)} tests)`);
    const result = await generateSpecs(ctx, group);
    for (const file of result.files) {
      generated.push(file);
      if (file.path.endsWith(".spec.ts") || file.path.endsWith(".test.ts")) {
        specCount++;
        const fromComments = extractTraceabilityIds(file.content);
        specTestIdsByPath.set(
          file.path,
          fromComments.length > 0 ? fromComments : testCases.map((tc) => tc.test_id),
        );
      }
    }
  }

  // 4. Write generated files, then the `.env.example` for referenced env vars.
  for (const file of generated) {
    writeGenerated(projectDir, file);
  }
  const envVars = collectEnvVars(generated);
  if (envVars.length > 0) {
    const envExample = `${envVars.map((v) => `${v}=`).join("\n")}\n`;
    writeFileSync(join(projectDir, ".env.example"), envExample, "utf8");
    scaffoldFiles.push(".env.example");
    logger.info(`Wrote .env.example (${String(envVars.length)} credential var(s)).`);
  }

  // 5. Validation loop (npm install → tsc → --list → lint), then re-sync files.
  const validation = await runValidation(ctx, {
    projectDir,
    files: generated,
    skipValidate: options.skipValidate === true,
  });

  // 6. Manifest — travels with the project.
  const manifestFiles: GeneratedFile[] = [
    ...scaffoldFiles.map((path) => ({ path, kind: "scaffold" as const, test_ids: [] })),
    ...validation.files.map((file) => ({
      path: file.path,
      kind: classifyKind(file.path),
      test_ids: specTestIdsByPath.get(file.path) ?? [],
    })),
  ];
  const manifest: GenerationManifest = {
    plan_id: plan.plan_id,
    site_model: options.siteModelPath ?? "",
    target_url: baseUrl,
    project_dir: projectDir,
    files: manifestFiles,
    repair_rounds: validation.repairRounds,
    lint_warnings: validation.lintViolations.map(
      (v) => `${v.file}:${String(v.line)} ${v.rule} — ${v.message}`,
    ),
    generated_at: new Date().toISOString(),
  };
  const manifestPath = join(projectDir, "generation-manifest.json");
  writeArtifact({
    schema: GenerationManifestSchema,
    kind: "generation-manifest",
    path: manifestPath,
    data: manifest,
  });

  return {
    projectDir,
    fileCount: manifestFiles.length,
    pageObjectCount,
    specCount,
    repairRounds: validation.repairRounds,
    lintViolations: validation.lintViolations,
    manifestPath,
  };
}

function writeGenerated(projectDir: string, file: GenFile): void {
  const dest = resolve(projectDir, file.path);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, file.content, "utf8");
}
