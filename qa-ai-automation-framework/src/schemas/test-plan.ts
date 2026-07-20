/**
 * TestPlan artifact schemas — field-for-field port of the Python
 * `src/models/test_plan.py` (plan §4), with action/assertion types narrowed
 * to enums. `screenshot_diff` stays an enum member as a v1 schema hook
 * (executor stubs it to `skipped` — plan §6.3, §10).
 */

import { z } from "zod";

import { TestCategorySchema } from "./config.js";
import { artifactEnvelope } from "./versions.js";

export const ActionTypeSchema = z.enum([
  "navigate",
  "click",
  "fill",
  "select",
  "hover",
  "scroll",
  "wait",
  "screenshot",
  "keyboard",
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;

export const ActionSchema = z.object({
  action_type: ActionTypeSchema,
  selector: z.string().nullable().default(null),
  value: z.string().nullable().default(null),
  description: z.string().default(""),
});
export type Action = z.infer<typeof ActionSchema>;

export const AssertionTypeSchema = z.enum([
  "element_visible",
  "element_hidden",
  "text_contains",
  "text_equals",
  "text_matches",
  "url_matches",
  "screenshot_diff",
  "element_count",
  "network_request_made",
  "no_console_errors",
  "response_status",
  "ai_evaluate",
  "page_title_contains",
  "page_loaded",
]);
export type AssertionType = z.infer<typeof AssertionTypeSchema>;

export const AssertionSchema = z.object({
  assertion_type: AssertionTypeSchema,
  selector: z.string().nullable().default(null),
  expected_value: z.string().nullable().default(null),
  tolerance: z.number().nullable().default(null),
  description: z.string().default(""),
});
export type Assertion = z.infer<typeof AssertionSchema>;

export const TestCaseSchema = z.object({
  test_id: z.string(),
  name: z.string(),
  description: z.string().default(""),
  category: TestCategorySchema.default("functional"),
  /** 1 (critical) to 5 (low). */
  priority: z.number().int().min(1).max(5).default(3),
  target_page_id: z.string().default(""),
  coverage_signature: z.string().default(""),
  requires_auth: z.boolean().default(true),
  preconditions: z.array(ActionSchema).default([]),
  steps: z.array(ActionSchema).default([]),
  assertions: z.array(AssertionSchema).default([]),
  timeout_seconds: z.number().int().positive().default(30),
});
export type TestCase = z.infer<typeof TestCaseSchema>;

export const TestPlanSchema = z.object({
  ...artifactEnvelope,
  plan_id: z.string(),
  generated_at: z.string(),
  target_url: z.string(),
  test_cases: z.array(TestCaseSchema).default([]),
  estimated_duration_seconds: z.number().int().min(0).default(0),
  coverage_intent: z.record(z.string(), z.unknown()).default({}),
});
export type TestPlan = z.infer<typeof TestPlanSchema>;
