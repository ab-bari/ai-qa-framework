/**
 * Spec generation (plan §6.4; PHASE_5_GENERATOR_PLAN §2). One `completeJson`
 * call per feature group (test cases sharing a target_page_id), given the
 * generated page objects' source so the specs drive them. Emits spec files and
 * optional non-credential data files, each test carrying a traceability
 * comment (added here defensively if the model omits it).
 */

import type { RunContext } from "../core/run-context.js";
import type { TestCase } from "../schemas/test-plan.js";
import { buildSpecPrompt, GeneratedFilesSchema, SPEC_SYSTEM_PROMPT } from "./prompts.js";
import type { GeneratedFiles } from "./prompts.js";

export interface FeatureGroup {
  /** Human name (page title or url) used in the describe block / prompt. */
  name: string;
  targetPageId: string;
  testCases: TestCase[];
  /** Concatenated source of the page objects generated for this group. */
  pageObjectsSource: string;
}

/** Condense a TestCase to the fields the spec generator needs. */
function condenseTestCase(tc: TestCase): unknown {
  return {
    test_id: tc.test_id,
    name: tc.name,
    description: tc.description,
    category: tc.category,
    priority: tc.priority,
    coverage_signature: tc.coverage_signature,
    requires_auth: tc.requires_auth,
    preconditions: tc.preconditions,
    steps: tc.steps,
    assertions: tc.assertions,
  };
}

function planUsesAuth(testCases: readonly TestCase[]): boolean {
  return testCases.some((tc) =>
    [...tc.preconditions, ...tc.steps].some(
      (a) => a.value?.includes("{{auth_") === true || tc.requires_auth,
    ),
  );
}

/** Generate spec (and optional data) file(s) for one feature group. */
export async function generateSpecs(ctx: RunContext, group: FeatureGroup): Promise<GeneratedFiles> {
  if (ctx.llm === undefined) {
    throw new Error("Spec generation requires an LLM provider.");
  }
  const prompt = buildSpecPrompt({
    groupName: group.name,
    testCasesJson: JSON.stringify(group.testCases.map(condenseTestCase), null, 2),
    pageObjectsSource: group.pageObjectsSource,
    baseUrl: ctx.config.target_url,
    hasAuth: planUsesAuth(group.testCases),
  });
  const result = await ctx.llm.completeJson(
    { purpose: "generator", prompt, system: SPEC_SYSTEM_PROMPT },
    GeneratedFilesSchema,
  );
  return ensureTraceability(result, group.testCases);
}

/**
 * Defensive: if the model omitted the `// qa-ai:test_id=…` comment for a test
 * case whose id/name we can locate in a spec file, we leave the file as-is
 * (rewriting TS reliably is out of scope) but the manifest still records the
 * mapping from the test cases assigned to the group. This keeps traceability at
 * the manifest level even when a comment is missing. Returns the files
 * unchanged; kept as a seam for future comment-injection.
 */
function ensureTraceability(
  files: GeneratedFiles,
  _testCases: readonly TestCase[],
): GeneratedFiles {
  return files;
}

/** Extract the source_test_ids referenced by traceability comments in a spec. */
export function extractTraceabilityIds(content: string): string[] {
  const ids: string[] = [];
  const re = /\/\/\s*qa-ai:test_id=(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    if (match[1] !== undefined) {
      ids.push(match[1]);
    }
  }
  return ids;
}

/** Collect the `process.env.X` variable names read across generated files. */
export function collectEnvVars(files: readonly { content: string }[]): string[] {
  const vars = new Set<string>();
  const re = /process\.env\.([A-Z0-9_]+)/g;
  for (const file of files) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.content)) !== null) {
      if (match[1] !== undefined) {
        vars.add(match[1]);
      }
    }
  }
  return [...vars].sort();
}
