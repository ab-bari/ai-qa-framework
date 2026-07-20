/**
 * Minimal Zod schema for the parts of Playwright's NATIVE JSON reporter
 * output that the healer consumes (plan §4): suites → specs → tests →
 * results (title, file, status, errors, retries). Loose objects keep every
 * field Playwright emits beyond the ones we read.
 */

import { z } from "zod";

export const PwLocationSchema = z.looseObject({
  file: z.string(),
  line: z.number(),
  column: z.number(),
});
export type PwLocation = z.infer<typeof PwLocationSchema>;

export const PwErrorSchema = z.looseObject({
  message: z.string().optional(),
  stack: z.string().optional(),
  value: z.string().optional(),
  snippet: z.string().optional(),
  location: PwLocationSchema.optional(),
});
export type PwError = z.infer<typeof PwErrorSchema>;

export const PwTestResultSchema = z.looseObject({
  status: z.string(),
  duration: z.number().optional(),
  retry: z.number().int().default(0),
  error: PwErrorSchema.optional(),
  errors: z.array(PwErrorSchema).default([]),
  startTime: z.string().optional(),
});
export type PwTestResult = z.infer<typeof PwTestResultSchema>;

export const PwTestSchema = z.looseObject({
  expectedStatus: z.string().optional(),
  projectName: z.string().optional(),
  /** Outcome bucket: expected | unexpected | flaky | skipped. */
  status: z.string().optional(),
  results: z.array(PwTestResultSchema).default([]),
});
export type PwTest = z.infer<typeof PwTestSchema>;

export const PwSpecSchema = z.looseObject({
  title: z.string(),
  ok: z.boolean().optional(),
  file: z.string().optional(),
  line: z.number().optional(),
  column: z.number().optional(),
  id: z.string().optional(),
  tests: z.array(PwTestSchema).default([]),
});
export type PwSpec = z.infer<typeof PwSpecSchema>;

export const PwSuiteSchema = z.looseObject({
  title: z.string(),
  file: z.string().optional(),
  specs: z.array(PwSpecSchema).default([]),
  get suites() {
    return z.array(PwSuiteSchema).optional();
  },
});
export type PwSuite = z.infer<typeof PwSuiteSchema>;

export const PwStatsSchema = z.looseObject({
  startTime: z.string().optional(),
  duration: z.number().optional(),
  expected: z.number().int().optional(),
  unexpected: z.number().int().optional(),
  flaky: z.number().int().optional(),
  skipped: z.number().int().optional(),
});
export type PwStats = z.infer<typeof PwStatsSchema>;

export const PwJsonReportSchema = z.looseObject({
  suites: z.array(PwSuiteSchema).default([]),
  errors: z.array(PwErrorSchema).default([]),
  stats: PwStatsSchema.optional(),
});
export type PwJsonReport = z.infer<typeof PwJsonReportSchema>;
