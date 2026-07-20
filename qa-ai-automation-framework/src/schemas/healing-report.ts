/**
 * Healing session artifact schemas (plan §4, §6.6). Rendered as
 * healing-report.html (primary) plus healing-report.json.
 */

import { z } from "zod";

import { artifactEnvelope } from "./versions.js";

export const FailureClassificationSchema = z.enum([
  "locator",
  "assertion",
  "navigation",
  "data",
  "app_bug",
  "environment",
]);
export type FailureClassification = z.infer<typeof FailureClassificationSchema>;

export const FailureTriageSchema = z.object({
  /** Reference to the failing test: "<spec file> › <test title>". */
  test_ref: z.string(),
  classification: FailureClassificationSchema,
  healable: z.boolean(),
  reasoning: z.string().default(""),
});
export type FailureTriage = z.infer<typeof FailureTriageSchema>;

export const PatchRecordSchema = z.object({
  file_path: z.string(),
  backup_path: z.string(),
  diff_path: z.string().default(""),
  diff_unified: z.string().default(""),
  attempt: z.number().int().min(1),
  description: z.string().default(""),
});
export type PatchRecord = z.infer<typeof PatchRecordSchema>;

export const VerifyStatusSchema = z.enum(["pass", "fail", "error", "not_run"]);
export type VerifyStatus = z.infer<typeof VerifyStatusSchema>;

export const HealAttemptSchema = z.object({
  attempt_no: z.number().int().min(1),
  patches: z.array(PatchRecordSchema).default([]),
  verify_status: VerifyStatusSchema.default("not_run"),
  verify_error: z.string().nullable().default(null),
});
export type HealAttempt = z.infer<typeof HealAttemptSchema>;

export const HealFinalStatusSchema = z.enum([
  "healed",
  "unhealable",
  "gave_up",
  "app_bug_suspected",
]);
export type HealFinalStatus = z.infer<typeof HealFinalStatusSchema>;

export const HealedTestSchema = z.object({
  /** Original TestCase id resolved via `// qa-ai:test_id=…` traceability comments. */
  source_test_id: z.string().default(""),
  spec_file: z.string(),
  test_title: z.string(),
  triage: FailureTriageSchema,
  attempts: z.array(HealAttemptSchema).default([]),
  final_status: HealFinalStatusSchema,
});
export type HealedTest = z.infer<typeof HealedTestSchema>;

export const HealingReportSchema = z.object({
  ...artifactEnvelope,
  session_id: z.string(),
  /** Path to the automation run folder whose results.json was healed. */
  automation_run_path: z.string(),
  started_at: z.string(),
  completed_at: z.string(),
  tests_considered: z.number().int().min(0).default(0),
  tests_healed: z.number().int().min(0).default(0),
  tests_unhealable: z.number().int().min(0).default(0),
  healed_tests: z.array(HealedTestSchema).default([]),
  summary: z.string().default(""),
});
export type HealingReport = z.infer<typeof HealingReportSchema>;
