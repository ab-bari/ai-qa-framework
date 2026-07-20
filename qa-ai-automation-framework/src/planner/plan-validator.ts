/**
 * Plan validation + normalization (plan §6.2). The LLM response is extracted
 * with a lenient wrapper schema (so one malformed test case never sinks the
 * whole plan), then each case is validated INDIVIDUALLY here: structural
 * `TestCaseSchema` parse + semantic checks (port of the Python
 * `schema_validator.validate_test_plan`) + coverage-signature derivation.
 * Invalid cases are dropped one at a time, each with a recorded reason — never
 * a silent skip (plan §10).
 */

import { z } from "zod";

import type { FrameworkConfig } from "../schemas/config.js";
import { TestCaseSchema, type TestCase } from "../schemas/test-plan.js";

/**
 * Lenient wrapper for the raw LLM response. Test cases are kept as opaque
 * records so `completeJson` accepts structurally-odd cases; strict per-case
 * validation happens in `validateTestCases`.
 */
export const RawPlanResponseSchema = z.object({
  plan_id: z.string().optional(),
  test_cases: z.array(z.record(z.string(), z.unknown())).default([]),
  estimated_duration_seconds: z.number().optional(),
  coverage_intent: z.record(z.string(), z.unknown()).optional(),
});
export type RawPlanResponse = z.infer<typeof RawPlanResponseSchema>;

export interface DroppedCase {
  index: number;
  test_id: string;
  reason: string;
}

export interface ValidationResult {
  testCases: TestCase[];
  dropped: DroppedCase[];
}

const SELECTOR_ACTIONS = new Set(["click", "fill", "select", "hover"]);

/** kebab-case slug of a test name for coverage signatures. */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "unnamed"
  );
}

/** `category:target_page_id:slug(name)` — matches the plan's signature recipe (plan §6.2). */
export function deriveCoverageSignature(tc: TestCase): string {
  return `${tc.category}:${tc.target_page_id}:${slugify(tc.name)}`;
}

/** Semantic issues that a structurally-valid case can still have (port of the Python validator). */
function semanticIssue(tc: TestCase, allowedCategories: ReadonlySet<string>): string | null {
  if (!allowedCategories.has(tc.category)) {
    return `category '${tc.category}' is not enabled in config.categories`;
  }
  if (tc.steps.length === 0) {
    return "no steps defined";
  }
  for (const [i, action] of tc.steps.entries()) {
    if (SELECTOR_ACTIONS.has(action.action_type) && (action.selector ?? "") === "") {
      return `step ${String(i)}: ${action.action_type} requires a selector`;
    }
    if (action.action_type === "fill" && (action.value ?? "") === "") {
      return `step ${String(i)}: fill requires a value`;
    }
  }
  return null;
}

/**
 * Validate and normalize raw test cases (plan §6.2). Returns the surviving,
 * fully-typed cases plus a per-drop reason log. Duplicate test_ids are dropped
 * after the first occurrence; missing coverage signatures are derived.
 */
export function validateTestCases(
  rawCases: Record<string, unknown>[],
  config: FrameworkConfig,
): ValidationResult {
  const allowedCategories = new Set<string>(config.categories);
  const testCases: TestCase[] = [];
  const dropped: DroppedCase[] = [];
  const seenIds = new Set<string>();

  for (const [index, raw] of rawCases.entries()) {
    const rawId = typeof raw.test_id === "string" ? raw.test_id : `#${String(index)}`;

    const parsed = TestCaseSchema.safeParse(raw);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const path = firstIssue ? firstIssue.path.join(".") || "(root)" : "(root)";
      const message = firstIssue ? firstIssue.message : "schema validation failed";
      dropped.push({ index, test_id: rawId, reason: `${path}: ${message}` });
      continue;
    }
    const tc = parsed.data;

    const issue = semanticIssue(tc, allowedCategories);
    if (issue !== null) {
      dropped.push({ index, test_id: tc.test_id, reason: issue });
      continue;
    }

    if (seenIds.has(tc.test_id)) {
      dropped.push({ index, test_id: tc.test_id, reason: "duplicate test_id" });
      continue;
    }
    seenIds.add(tc.test_id);

    if (tc.coverage_signature === "") {
      tc.coverage_signature = deriveCoverageSignature(tc);
    }
    testCases.push(tc);
  }

  return { testCases, dropped };
}
