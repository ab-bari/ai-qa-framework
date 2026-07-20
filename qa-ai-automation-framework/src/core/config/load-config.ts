/**
 * Config loading with Zod validation and `env:` prefix resolution for
 * secrets (plan §3). Mirrors the Python FrameworkConfig behavior: missing
 * env vars fail fast, and crawl.target_url defaults to the top-level
 * target_url.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { ConfigError } from "../errors.js";
import { FrameworkConfigSchema, type FrameworkConfig } from "../../schemas/config.js";

const ENV_PREFIX = "env:";

/** Resolve an `env:VAR_NAME` reference against process.env; plain values pass through. */
export function resolveEnvValue(value: string, fieldName: string): string {
  if (!value.startsWith(ENV_PREFIX)) {
    return value;
  }
  const envVar = value.slice(ENV_PREFIX.length);
  const resolved = process.env[envVar];
  if (resolved === undefined) {
    throw new ConfigError(
      `Environment variable '${envVar}' (referenced by ${fieldName}) is not set.`,
      { remediation: `Set ${envVar} in your environment before running qa-ai.` },
    );
  }
  return resolved;
}

export function loadConfig(path: string): FrameworkConfig {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new ConfigError(`Config file not found: ${absolute}`, {
      remediation:
        "Copy qa-config.example.json to qa-config.json and edit it, or pass --config <path>.",
    });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (cause) {
    throw new ConfigError(`Config file is not valid JSON: ${absolute}`, { cause });
  }

  const parsed = FrameworkConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config ${absolute}:\n${issues}`, {
      remediation: "Fix the listed fields; see qa-config.example.json for the expected shape.",
    });
  }

  const config = parsed.data;
  if (config.auth !== null) {
    config.auth.username = resolveEnvValue(config.auth.username, "auth.username");
    config.auth.password = resolveEnvValue(config.auth.password, "auth.password");
  }
  if (config.crawl.target_url === "") {
    config.crawl.target_url = config.target_url;
  }
  return config;
}
