/**
 * Evidence capture (plan §6.3, §3 workspace layout): per-step screenshots,
 * console logs and network traffic for one test, written under
 * `.qa/runs/run-<ts>/evidence/<test_id>/`. Port of the Python
 * `src/executor/evidence_collector.py`, with secret masking added.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Page } from "playwright";

import type { Logger } from "../core/logger.js";
import type { Evidence } from "../schemas/run-result.js";
import { maskSecrets } from "./placeholders.js";

export interface NetworkEntry extends Record<string, unknown> {
  url: string;
  method: string;
  status: number;
  resource_type: string;
}

export class EvidenceCollector {
  readonly consoleLogs: string[] = [];
  readonly networkLog: NetworkEntry[] = [];
  private readonly screenshots: string[] = [];
  private screenshotCount = 0;
  private domSnapshotPath: string | null = null;

  constructor(
    private readonly evidenceDir: string,
    private readonly logger: Logger,
    private readonly secrets: readonly string[] = [],
  ) {
    mkdirSync(evidenceDir, { recursive: true });
  }

  /** Attach console + response listeners to a page. */
  attach(page: Page): void {
    page.on("console", (message) => {
      this.consoleLogs.push(maskSecrets(`[${message.type()}] ${message.text()}`, this.secrets));
    });
    page.on("response", (response) => {
      this.networkLog.push({
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
        resource_type: response.request().resourceType(),
      });
    });
  }

  /** Capture a screenshot; returns its path, or null when capture failed. */
  async screenshot(page: Page, label: string): Promise<string | null> {
    this.screenshotCount++;
    const name = `screenshot-${label}-${String(this.screenshotCount)}.png`;
    const path = join(this.evidenceDir, name);
    try {
      await page.screenshot({ path, fullPage: false });
      this.screenshots.push(path);
      return path;
    } catch (error) {
      this.logger.debug(`Screenshot '${label}' failed: ${String(error)}`);
      return null;
    }
  }

  /** Save the current DOM for post-mortem analysis (used on failure paths). */
  async captureDomSnapshot(page: Page): Promise<string | null> {
    const path = join(this.evidenceDir, "dom-snapshot.html");
    try {
      writeFileSync(path, maskSecrets(await page.content(), this.secrets), "utf8");
      this.domSnapshotPath = path;
      return path;
    } catch (error) {
      this.logger.debug(`DOM snapshot failed: ${String(error)}`);
      return null;
    }
  }

  /** Add a screenshot captured elsewhere (e.g. by an assertion). */
  addScreenshot(path: string): void {
    this.screenshots.push(path);
  }

  /** Console errors only — the input to the `no_console_errors` assertion. */
  consoleErrors(): string[] {
    return this.consoleLogs.filter((line) => line.startsWith("[error]"));
  }

  /** Persist logs to disk and build the Evidence artifact fragment. */
  finalize(): Evidence {
    try {
      writeFileSync(join(this.evidenceDir, "console.log"), this.consoleLogs.join("\n"), "utf8");
      writeFileSync(
        join(this.evidenceDir, "network.json"),
        `${JSON.stringify(this.networkLog, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      this.logger.debug(`Failed to persist evidence logs: ${String(error)}`);
    }
    return {
      screenshots: [...this.screenshots],
      console_logs: [...this.consoleLogs],
      network_log: [...this.networkLog],
      dom_snapshot_path: this.domSnapshotPath,
      video_path: null,
    };
  }
}
