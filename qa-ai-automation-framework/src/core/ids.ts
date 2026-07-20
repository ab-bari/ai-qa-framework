/**
 * Stable ID generation — ported from the Python framework's `src/url_utils.py`
 * and crawler ID recipes so page/element ids stay familiar across frameworks.
 */

import { createHash } from "node:crypto";

export function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

/**
 * Normalize a URL for deduplication (port of Python `normalize_url`):
 * drop the fragment, strip trailing slashes from the path (keeping "/"),
 * and sort query parameters as raw `key=value` strings.
 */
export function normalizeUrl(url: string): string {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  let query = "";
  const rawQuery = parsed.search.startsWith("?") ? parsed.search.slice(1) : parsed.search;
  if (rawQuery !== "") {
    query = `?${rawQuery.split("&").sort().join("&")}`;
  }
  return `${parsed.protocol}//${parsed.host}${path}${query}`;
}

/** Stable 12-char page id from the normalized URL (port of `page_id_from_url`). */
export function pageIdFromUrl(url: string): string {
  return md5Hex(normalizeUrl(url)).slice(0, 12);
}

/** Stable 10-char element id (plan §6.1: md5 over page_id + selector + tag). */
export function elementId(pageId: string, selector: string, tag: string): string {
  return md5Hex(`${pageId}:${selector}:${tag}`).slice(0, 10);
}

/** Filesystem-safe timestamp, e.g. "20260720-153012". */
export function timestampId(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

export function newPlanId(date?: Date): string {
  return `plan-${timestampId(date)}`;
}

export function newRunId(date?: Date): string {
  return `run-${timestampId(date)}`;
}

export function newSessionId(date?: Date): string {
  return `session-${timestampId(date)}`;
}
