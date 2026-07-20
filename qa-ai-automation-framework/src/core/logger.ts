/**
 * Leveled console + optional file logger (plan §3). No module-level mutable
 * state — every command builds its own logger and passes it down via
 * RunContext.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  readonly level: LogLevel;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** A logger that prefixes every message with `[scope]`. */
  child(scope: string): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** When set, every emitted line is also appended to this file. */
  filePath?: string;
  scope?: string;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? "info";
  const threshold = LEVEL_ORDER[level];
  const scopePrefix = options.scope === undefined ? "" : `[${options.scope}] `;
  let fileReady = false;

  const emit = (messageLevel: LogLevel, message: string): void => {
    if (LEVEL_ORDER[messageLevel] < threshold) {
      return;
    }
    const line = `${new Date().toISOString()} ${messageLevel.toUpperCase().padEnd(5)} ${scopePrefix}${message}`;
    if (messageLevel === "error") {
      console.error(line);
    } else if (messageLevel === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
    if (options.filePath !== undefined) {
      if (!fileReady) {
        mkdirSync(dirname(options.filePath), { recursive: true });
        fileReady = true;
      }
      appendFileSync(options.filePath, `${line}\n`, "utf8");
    }
  };

  return {
    level,
    debug: (message) => {
      emit("debug", message);
    },
    info: (message) => {
      emit("info", message);
    },
    warn: (message) => {
      emit("warn", message);
    },
    error: (message) => {
      emit("error", message);
    },
    child: (scope) =>
      createLogger({
        level,
        ...(options.filePath === undefined ? {} : { filePath: options.filePath }),
        scope: options.scope === undefined ? scope : `${options.scope}:${scope}`,
      }),
  };
}
