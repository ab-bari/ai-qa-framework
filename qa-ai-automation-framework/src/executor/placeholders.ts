/**
 * Placeholder resolution (plan §6.2/§6.3). The TestPlan on disk is
 * credential-free: the planner emits `{{auth_username}}`, `{{auth_password}}`,
 * `{{auth_login_url}}` and `{{$timestamp}}` tokens, and the executor resolves
 * them at execution time.
 *
 * Dynamic `{{$…}}` values are snapshotted ONCE per test case so preconditions
 * and steps observe the same `{{$timestamp}}`. Resolution never mutates the
 * plan — it returns copies, so the artifact on disk stays credential-free.
 */

import type { Logger } from "../core/logger.js";
import type { AuthConfig } from "../schemas/config.js";
import type { Action, Assertion, TestCase } from "../schemas/test-plan.js";

const PLACEHOLDER_RE = /\{\{(\$?[\w-]+)\}\}/g;

export interface PlaceholderContext {
  /** token name (without braces) → replacement value. */
  readonly values: ReadonlyMap<string, string>;
  /** Secret values that must be masked before anything is logged. */
  readonly secrets: readonly string[];
}

/**
 * Build the resolution table for one test case: auth credentials from config
 * plus a single snapshot of the dynamic variables.
 */
export function buildPlaceholderContext(
  auth: AuthConfig | null,
  now: Date = new Date(),
): PlaceholderContext {
  const values = new Map<string, string>();
  values.set("$timestamp", String(Math.floor(now.getTime() / 1000)));
  values.set("$isoTimestamp", now.toISOString());

  const secrets: string[] = [];
  if (auth !== null) {
    values.set("auth_username", auth.username);
    values.set("auth_password", auth.password);
    values.set("auth_login_url", auth.login_url);
    if (auth.password !== "") {
      secrets.push(auth.password);
    }
  }
  return { values, secrets };
}

/** Replace known tokens in `text`; unknown tokens are left intact and logged. */
export function resolveText(
  text: string,
  ctx: PlaceholderContext,
  logger?: Logger,
): { text: string; unresolved: string[] } {
  const unresolved: string[] = [];
  const resolved = text.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = ctx.values.get(name);
    if (value === undefined) {
      unresolved.push(name);
      return match;
    }
    return value;
  });
  for (const name of unresolved) {
    logger?.warn(`Unresolved placeholder {{${name}}} left as-is.`);
  }
  return { text: resolved, unresolved };
}

function resolveNullable(
  value: string | null,
  ctx: PlaceholderContext,
  logger?: Logger,
): string | null {
  return value === null ? null : resolveText(value, ctx, logger).text;
}

function resolveAction(action: Action, ctx: PlaceholderContext, logger?: Logger): Action {
  return {
    ...action,
    selector: resolveNullable(action.selector, ctx, logger),
    value: resolveNullable(action.value, ctx, logger),
  };
}

function resolveAssertion(
  assertion: Assertion,
  ctx: PlaceholderContext,
  logger?: Logger,
): Assertion {
  return {
    ...assertion,
    selector: resolveNullable(assertion.selector, ctx, logger),
    expected_value: resolveNullable(assertion.expected_value, ctx, logger),
  };
}

/** Return a copy of `testCase` with every placeholder resolved. */
export function resolveTestCase(
  testCase: TestCase,
  ctx: PlaceholderContext,
  logger?: Logger,
): TestCase {
  return {
    ...testCase,
    preconditions: testCase.preconditions.map((action) => resolveAction(action, ctx, logger)),
    steps: testCase.steps.map((action) => resolveAction(action, ctx, logger)),
    assertions: testCase.assertions.map((assertion) => resolveAssertion(assertion, ctx, logger)),
  };
}

/**
 * Replace secret values with `***` — applied to every string that reaches a
 * log line, an evidence file, or an artifact field.
 */
export function maskSecrets(text: string, secrets: readonly string[]): string {
  let masked = text;
  for (const secret of secrets) {
    if (secret.length >= 3) {
      masked = masked.split(secret).join("***");
    }
  }
  return masked;
}
