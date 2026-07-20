/**
 * Framework configuration schemas (plan §4). Ported from the Python
 * `src/models/config.py` with the plan's deliberate v1 changes:
 * ai_provider is "claude-code" | "claude-code-cli" ("anthropic-api" and
 * "ollama" reserved), visual/video settings are dropped, and `workspace_dir`
 * is added. Artifact/config JSON keys stay snake_case.
 */

import { z } from "zod";

export const ViewportConfigSchema = z.object({
  width: z.number().int().positive().default(1280),
  height: z.number().int().positive().default(720),
  name: z.string().default("desktop"),
});
export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const CrawlConfigSchema = z.object({
  target_url: z.string().default(""),
  max_pages: z.number().int().positive().default(10),
  max_depth: z.number().int().positive().default(5),
  include_patterns: z.array(z.string()).default([]),
  exclude_patterns: z.array(z.string()).default([]),
  wait_for_idle: z.boolean().default(true),
  viewport: ViewportConfigSchema.prefault({}),
  user_agent: z.string().nullable().default(null),
});
export type CrawlConfig = z.infer<typeof CrawlConfigSchema>;

export const AuthConfigSchema = z.object({
  login_url: z.string().min(1),
  /** May be an `env:VAR_NAME` reference — resolved by the config loader. */
  username: z.string().min(1),
  /** May be an `env:VAR_NAME` reference — resolved by the config loader. */
  password: z.string().min(1),
  username_selector: z.string().default(""),
  password_selector: z.string().default(""),
  submit_selector: z.string().default(""),
  success_indicator: z.string().default(""),
  auto_detect: z.boolean().default(true),
  llm_fallback: z.boolean().default(true),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/** "visual" is reserved for a later version (plan §10); v1 plans functional + security. */
export const TestCategorySchema = z.enum(["functional", "security", "visual"]);
export type TestCategory = z.infer<typeof TestCategorySchema>;

/** "anthropic-api" and "ollama" are reserved interface slots (plan §10). */
export const AiProviderSchema = z.enum([
  "claude-code",
  "claude-code-cli",
  "anthropic-api",
  "ollama",
]);
export type AiProvider = z.infer<typeof AiProviderSchema>;

export const FrameworkConfigSchema = z.object({
  target_url: z.string().min(1),
  auth: AuthConfigSchema.nullable().default(null),
  crawl: CrawlConfigSchema.prefault({}),
  categories: z.array(TestCategorySchema).default(["functional", "security"]),
  max_tests_per_run: z.number().int().positive().default(20),
  max_execution_time_seconds: z.number().int().positive().default(1800),
  max_parallel_contexts: z.number().int().positive().default(3),
  selector_timeout_seconds: z.number().int().positive().default(10),
  ai_provider: AiProviderSchema.default("claude-code"),
  /** Model name passed to the provider; "" lets the provider pick its default. */
  ai_model: z.string().default(""),
  ai_max_fallback_calls_per_test: z.number().int().min(0).default(3),
  staleness_threshold_days: z.number().int().positive().default(7),
  history_retention_runs: z.number().int().positive().default(20),
  hints: z.array(z.string()).default([]),
  workspace_dir: z.string().default(".qa"),
});
export type FrameworkConfig = z.infer<typeof FrameworkConfigSchema>;
