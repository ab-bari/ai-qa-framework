/**
 * Coverage registry schemas — field-for-field port of the Python
 * `src/models/coverage.py` (plan §4). Python tuples become Zod tuples.
 */

import { z } from "zod";

import { artifactEnvelope } from "./versions.js";

export const TestResultSummarySchema = z.object({
  run_id: z.string(),
  timestamp: z.string(),
  result: z.string(),
  duration_seconds: z.number().min(0).default(0),
  failure_reason: z.string().nullable().default(null),
});
export type TestResultSummary = z.infer<typeof TestResultSummarySchema>;

export const SignatureRecordSchema = z.object({
  signature: z.string(),
  last_tested: z.string().default(""),
  last_result: z.string().default(""),
  test_count: z.number().int().min(0).default(0),
  history: z.array(TestResultSummarySchema).default([]),
});
export type SignatureRecord = z.infer<typeof SignatureRecordSchema>;

export const ElementCoverageSchema = z.object({
  element_id: z.string(),
  tested: z.boolean().default(false),
  last_tested: z.string().nullable().default(null),
  test_count: z.number().int().min(0).default(0),
});
export type ElementCoverage = z.infer<typeof ElementCoverageSchema>;

export const CategoryCoverageSchema = z.object({
  category: z.string(),
  signatures_tested: z.array(SignatureRecordSchema).default([]),
  coverage_score: z.number().min(0).default(0),
  last_tested: z.string().default(""),
});
export type CategoryCoverage = z.infer<typeof CategoryCoverageSchema>;

export const PageCoverageSchema = z.object({
  page_id: z.string(),
  url: z.string(),
  page_type: z.string().default(""),
  categories: z.record(z.string(), CategoryCoverageSchema).default({}),
  elements_tested: z.record(z.string(), ElementCoverageSchema).default({}),
  last_tested: z.string().default(""),
  test_count: z.number().int().min(0).default(0),
});
export type PageCoverage = z.infer<typeof PageCoverageSchema>;

export const GlobalCoverageStatsSchema = z.object({
  total_pages: z.number().int().min(0).default(0),
  pages_tested: z.number().int().min(0).default(0),
  overall_score: z.number().min(0).default(0),
  category_scores: z.record(z.string(), z.number()).default({}),
  last_full_run: z.string().default(""),
  regression_count: z.number().int().min(0).default(0),
});
export type GlobalCoverageStats = z.infer<typeof GlobalCoverageStatsSchema>;

export const CoverageGapReportSchema = z.object({
  untested_pages: z.array(z.string()).default([]),
  stale_pages: z.array(z.string()).default([]),
  /** [page_id, category, score] — port of Python list[tuple[str, str, float]]. */
  low_coverage_areas: z.array(z.tuple([z.string(), z.string(), z.number()])).default([]),
  /** [page_id, signature] — port of Python list[tuple[str, str]]. */
  recent_failures: z.array(z.tuple([z.string(), z.string()])).default([]),
  suggested_focus: z.array(z.string()).default([]),
});
export type CoverageGapReport = z.infer<typeof CoverageGapReportSchema>;

export const CoverageRegistrySchema = z.object({
  ...artifactEnvelope,
  target_url: z.string(),
  last_updated: z.string().default(""),
  pages: z.record(z.string(), PageCoverageSchema).default({}),
  journeys: z.record(z.string(), z.unknown()).default({}),
  global_stats: GlobalCoverageStatsSchema.prefault({}),
});
export type CoverageRegistry = z.infer<typeof CoverageRegistrySchema>;
