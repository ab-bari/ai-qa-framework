/**
 * RunResult artifact schemas — field-for-field port of the Python
 * `src/models/test_result.py` (plan §4). `video_path` and `potentially_flaky`
 * are v1 schema hooks (always null/false — plan §10).
 */

import { z } from "zod";

import { TestCategorySchema } from "./config.js";
import { artifactEnvelope } from "./versions.js";

export const EvidenceSchema = z.object({
  /** Screenshot file paths. */
  screenshots: z.array(z.string()).default([]),
  console_logs: z.array(z.string()).default([]),
  network_log: z.array(z.record(z.string(), z.unknown())).default([]),
  dom_snapshot_path: z.string().nullable().default(null),
  /** Schema hook — video capture is out of scope for v1 (plan §10). */
  video_path: z.string().nullable().default(null),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const FallbackDecisionSchema = z.enum(["retry", "adapt", "skip", "abort"]);
export type FallbackDecision = z.infer<typeof FallbackDecisionSchema>;

export const FallbackRecordSchema = z.object({
  step_index: z.number().int().min(0),
  original_selector: z.string().default(""),
  decision: FallbackDecisionSchema,
  new_selector: z.string().nullable().default(null),
  reasoning: z.string().default(""),
});
export type FallbackRecord = z.infer<typeof FallbackRecordSchema>;

export const StepStatusSchema = z.enum(["pass", "fail", "skip"]);
export type StepStatus = z.infer<typeof StepStatusSchema>;

export const StepResultSchema = z.object({
  step_index: z.number().int().min(0),
  action_type: z.string(),
  selector: z.string().nullable().default(null),
  value: z.string().nullable().default(null),
  description: z.string().default(""),
  status: StepStatusSchema.default("pass"),
  error_message: z.string().nullable().default(null),
  screenshot_path: z.string().nullable().default(null),
});
export type StepResult = z.infer<typeof StepResultSchema>;

export const AssertionResultSchema = z.object({
  assertion_type: z.string(),
  selector: z.string().nullable().default(null),
  expected_value: z.string().nullable().default(null),
  description: z.string().default(""),
  passed: z.boolean().default(false),
  actual_value: z.string().nullable().default(null),
  message: z.string().default(""),
});
export type AssertionResult = z.infer<typeof AssertionResultSchema>;

export const TestOutcomeSchema = z.enum(["pass", "fail", "skip", "error"]);
export type TestOutcome = z.infer<typeof TestOutcomeSchema>;

export const TestResultSchema = z.object({
  test_id: z.string(),
  test_name: z.string(),
  description: z.string().default(""),
  category: TestCategorySchema,
  priority: z.number().int().min(1).max(5).default(3),
  target_page_id: z.string().default(""),
  /** page_id derived from the browser URL after steps execute. */
  actual_page_id: z.string().default(""),
  /** The browser URL after steps execute. */
  actual_url: z.string().default(""),
  coverage_signature: z.string().default(""),
  result: TestOutcomeSchema,
  duration_seconds: z.number().min(0).default(0),
  failure_reason: z.string().nullable().default(null),
  evidence: EvidenceSchema.prefault({}),
  fallback_records: z.array(FallbackRecordSchema).default([]),
  precondition_results: z.array(StepResultSchema).default([]),
  step_results: z.array(StepResultSchema).default([]),
  assertion_results: z.array(AssertionResultSchema).default([]),
  assertions_passed: z.number().int().min(0).default(0),
  assertions_failed: z.number().int().min(0).default(0),
  assertions_total: z.number().int().min(0).default(0),
  /** Schema hook — flaky detection is out of scope for v1, always false (plan §10). */
  potentially_flaky: z.boolean().default(false),
});
export type TestResult = z.infer<typeof TestResultSchema>;

export const RunResultSchema = z.object({
  ...artifactEnvelope,
  run_id: z.string(),
  plan_id: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  target_url: z.string(),
  total_tests: z.number().int().min(0).default(0),
  passed: z.number().int().min(0).default(0),
  failed: z.number().int().min(0).default(0),
  skipped: z.number().int().min(0).default(0),
  errors: z.number().int().min(0).default(0),
  duration_seconds: z.number().min(0).default(0),
  test_results: z.array(TestResultSchema).default([]),
  ai_summary: z.string().default(""),
});
export type RunResult = z.infer<typeof RunResultSchema>;
