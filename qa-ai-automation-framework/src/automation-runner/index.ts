/**
 * Automation test runner (plan §6.5). Operates on the generated
 * `automation-tests/` project: verifies package.json, installs dependencies
 * when node_modules is missing (or `--install`), ensures Chromium is present,
 * then spawns `npx playwright test` with the project's own html + json
 * reporters redirected into `.qa/automation-runs/run-<ts>/`.
 *
 * There is NO custom result-mapping layer: the human-facing output is
 * Playwright's native HTML report and the machine handoff for `qa-ai heal` is
 * Playwright's native `results.json`. We only READ results.json to print a
 * console summary and to point `automation-runs/latest.json` at it. No AI.
 */

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { BrowserError } from "../core/errors.js";
import { newRunId } from "../core/ids.js";
import type { RunContext } from "../core/run-context.js";
import { PwJsonReportSchema, type PwStats } from "../schemas/pw-json-report.js";

export interface RunGeneratedOptions {
  /** Generated project directory (default: workspace.automationTestsDir). */
  projectDir: string;
  /** Pass-through: only run tests whose title matches this pattern. */
  grep?: string | undefined;
  /** Pass-through: only run this spec file (a positional test filter). */
  spec?: string | undefined;
  /** Pass-through: run the browser headed. */
  headed?: boolean | undefined;
  /** Pass-through: number of Playwright workers. */
  workers?: number | undefined;
  /** Force `npm install` even when node_modules already exists. */
  install?: boolean | undefined;
}

export interface RunGeneratedResult {
  runDir: string;
  htmlReportDir: string;
  jsonReportPath: string;
  /** Playwright's own exit code (0 = all passed). Null only on abnormal exit. */
  playwrightExitCode: number | null;
  /** Parsed stats from results.json, when it was written and valid. */
  stats: PwStats | undefined;
}

interface CmdResult {
  code: number | null;
  spawnError: NodeJS.ErrnoException | null;
}

/**
 * Spawn a child with stdio inherited so the user sees live output. On Windows
 * we need shell:true to resolve the `.cmd` shims (npm/npx); shell mode does not
 * auto-quote, so we quote args that contain spaces or shell metacharacters.
 */
function runStreaming(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
): Promise<CmdResult> {
  const shell = process.platform === "win32";
  const finalArgs = shell ? args.map(quoteForShell) : args;
  return new Promise<CmdResult>((resolvePromise) => {
    const child = spawn(command, finalArgs, {
      cwd,
      shell,
      stdio: "inherit",
      ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
    });
    let spawnError: NodeJS.ErrnoException | null = null;
    child.on("error", (e: NodeJS.ErrnoException) => (spawnError = e));
    child.on("close", (code) => {
      resolvePromise({ code, spawnError });
    });
  });
}

function quoteForShell(arg: string): string {
  return /[\s&|<>^"]/.test(arg) ? `"${arg.replaceAll('"', '""')}"` : arg;
}

/** Playwright's browser cache location (mirrors `qa-ai doctor`). */
function playwrightBrowsersDir(): string | null {
  const override = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (override !== undefined && override !== "" && override !== "0") {
    return override;
  }
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
    return join(localAppData, "ms-playwright");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Caches", "ms-playwright");
  }
  return join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "ms-playwright");
}

function chromiumInstalled(): boolean {
  const dir = playwrightBrowsersDir();
  if (dir === null || !existsSync(dir)) {
    return false;
  }
  return readdirSync(dir).some((entry) => entry.startsWith("chromium"));
}

/** Read + validate results.json for the console summary (best-effort). */
function readStats(jsonReportPath: string, ctx: RunContext): PwStats | undefined {
  if (!existsSync(jsonReportPath)) {
    ctx.logger.warn(`No results.json was written at ${jsonReportPath}.`);
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(jsonReportPath, "utf8"));
  } catch (cause) {
    ctx.logger.warn(`results.json is not valid JSON: ${String(cause)}`);
    return undefined;
  }
  const parsed = PwJsonReportSchema.safeParse(raw);
  if (!parsed.success) {
    ctx.logger.warn("results.json did not match the expected Playwright JSON shape.");
    return undefined;
  }
  return parsed.data.stats;
}

async function ensureDependencies(
  ctx: RunContext,
  projectDir: string,
  force: boolean,
): Promise<void> {
  const { logger } = ctx;
  const nodeModules = join(projectDir, "node_modules");
  if (!force && existsSync(nodeModules)) {
    logger.debug("node_modules present — skipping npm install (use --install to force).");
    return;
  }
  logger.info(
    force
      ? "Installing dependencies (npm install, forced)..."
      : "node_modules missing — installing dependencies (npm install)...",
  );
  const result = await runStreaming("npm", ["install"], projectDir);
  if (result.spawnError !== null) {
    throw new BrowserError(`Could not run npm install: ${result.spawnError.message}`, {
      remediation: "Ensure Node.js and npm are installed and on PATH.",
    });
  }
  if (result.code !== 0) {
    throw new BrowserError(`npm install failed in ${projectDir} (exit ${String(result.code)}).`, {
      remediation: "Run 'npm install' in the generated project to see the full error.",
    });
  }
}

async function ensureChromium(ctx: RunContext, projectDir: string): Promise<void> {
  const { logger } = ctx;
  if (chromiumInstalled()) {
    logger.debug("Chromium browser already installed.");
    return;
  }
  logger.info("Chromium not found — installing (npx playwright install chromium)...");
  const result = await runStreaming("npx", ["playwright", "install", "chromium"], projectDir);
  if (result.spawnError !== null || result.code !== 0) {
    // Non-fatal: let Playwright surface a precise error on the test run itself.
    logger.warn(
      "Could not install Chromium automatically. If the run fails, execute " +
        "'npx playwright install chromium' in the generated project.",
    );
  }
}

/** Build the `playwright test` argument list from pass-through options. */
export function buildPlaywrightArgs(options: RunGeneratedOptions): string[] {
  const args = ["playwright", "test"];
  if (options.spec !== undefined && options.spec !== "") {
    args.push(options.spec);
  }
  if (options.grep !== undefined && options.grep !== "") {
    args.push("--grep", options.grep);
  }
  if (options.headed === true) {
    args.push("--headed");
  }
  if (options.workers !== undefined) {
    args.push("--workers", String(options.workers));
  }
  return args;
}

function summarize(ctx: RunContext, result: RunGeneratedResult): void {
  const { logger } = ctx;
  const s = result.stats;
  logger.info("");
  logger.info("Automation run complete.");
  if (s !== undefined) {
    const passed = s.expected ?? 0;
    const failed = s.unexpected ?? 0;
    const flaky = s.flaky ?? 0;
    const skipped = s.skipped ?? 0;
    logger.info(
      `  ${String(passed)} passed, ${String(failed)} failed, ` +
        `${String(flaky)} flaky, ${String(skipped)} skipped.`,
    );
  } else {
    logger.info(`  Playwright exit code: ${String(result.playwrightExitCode)}`);
  }
  logger.info(`  HTML report: ${result.htmlReportDir}`);
  logger.info(`    open with: npx playwright show-report "${result.htmlReportDir}"`);
  logger.info(`  JSON report (heal handoff): ${result.jsonReportPath}`);
}

/**
 * Run the generated Playwright project and write its native reports into a
 * fresh `.qa/automation-runs/run-<ts>/` folder. Reports are always written by
 * Playwright regardless of pass/fail; this function never deletes them.
 */
export async function runGenerated(
  ctx: RunContext,
  options: RunGeneratedOptions,
): Promise<RunGeneratedResult> {
  const { workspace, logger } = ctx;
  const projectDir = resolve(options.projectDir);

  if (!existsSync(projectDir) || !existsSync(join(projectDir, "package.json"))) {
    throw new BrowserError(`No generated Playwright project at ${projectDir}.`, {
      remediation: "Run 'qa-ai generate' first, or pass --project with the project path.",
    });
  }

  await ensureDependencies(ctx, projectDir, options.install === true);
  await ensureChromium(ctx, projectDir);

  const runDir = workspace.ensureDir("automation-runs", newRunId());
  const htmlReportDir = join(runDir, "playwright-report");
  const jsonReportPath = join(runDir, "results.json");

  const args = buildPlaywrightArgs(options);
  logger.info(`Running: npx ${args.join(" ")} (cwd: ${projectDir})`);
  logger.info(`Reports -> ${runDir}`);

  // Redirect the project's own reporters via env (argv-free so paths with
  // spaces are safe): _OUTPUT_FILE beats the config's outputFile for JSON;
  // _OUTPUT_DIR sets the HTML report folder. Open is forced off for CI-safety.
  const runResult = await runStreaming("npx", args, projectDir, reporterEnv(runDir)).catch(
    (e: unknown): CmdResult => ({ code: null, spawnError: e as NodeJS.ErrnoException }),
  );

  const stats = readStats(jsonReportPath, ctx);
  const result: RunGeneratedResult = {
    runDir,
    htmlReportDir,
    jsonReportPath,
    playwrightExitCode: runResult.code,
    stats,
  };

  // Point automation-runs/latest.json at the JSON report so `qa-ai heal`
  // (and the pipeline) can discover it without an explicit --run flag.
  if (existsSync(jsonReportPath)) {
    workspace.writeLatestPointer("automation-runs", jsonReportPath);
  }

  if (runResult.spawnError !== null) {
    throw new BrowserError(`Could not run Playwright: ${runResult.spawnError.message}`, {
      remediation: "Ensure the generated project installed correctly (retry with --install).",
    });
  }

  summarize(ctx, result);
  return result;
}

/** Env overrides that redirect the project's reporters into the run folder. */
export function reporterEnv(runDir: string): Record<string, string> {
  return {
    PLAYWRIGHT_HTML_OUTPUT_DIR: join(runDir, "playwright-report"),
    PLAYWRIGHT_JSON_OUTPUT_FILE: join(runDir, "results.json"),
    PLAYWRIGHT_HTML_OPEN: "never",
  };
}
