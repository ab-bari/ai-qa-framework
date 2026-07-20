import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PwJsonReportSchema } from "../../src/schemas/pw-json-report.js";

const fixture: unknown = JSON.parse(
  readFileSync(new URL("../fixtures/pw-report.json", import.meta.url), "utf8"),
);

describe("PwJsonReportSchema", () => {
  it("parses a native Playwright JSON report including nested suites", () => {
    const report = PwJsonReportSchema.parse(fixture);
    const fileSuite = report.suites[0];
    expect(fileSuite?.title).toBe("inventory\\inventory-page.spec.ts");
    const describeSuite = fileSuite?.suites?.[0];
    expect(describeSuite?.title).toBe("Inventory page");
    expect(describeSuite?.specs).toHaveLength(2);

    const failing = describeSuite?.specs[1];
    expect(failing?.ok).toBe(false);
    const attempts = failing?.tests[0]?.results;
    expect(attempts).toHaveLength(2);
    expect(attempts?.[0]?.status).toBe("failed");
    expect(attempts?.[1]?.retry).toBe(1);
    expect(attempts?.[0]?.error?.message).toContain("Timeout 30000ms exceeded");
    expect(attempts?.[0]?.errors[0]?.location?.line).toBe(21);
    expect(report.stats?.unexpected).toBe(1);
  });

  it("keeps fields we do not model (loose objects) so nothing is lost on re-serialize", () => {
    const report = PwJsonReportSchema.parse(fixture);
    // `config` is not modeled explicitly but must survive.
    expect(report.config).toMatchObject({ version: "1.49.0" });
    const spec = report.suites[0]?.suites?.[0]?.specs[0] as Record<string, unknown> | undefined;
    expect(spec?.tags).toEqual(["smoke"]);
  });

  it("tolerates a minimal empty report", () => {
    const report = PwJsonReportSchema.parse({});
    expect(report.suites).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(report.stats).toBeUndefined();
  });
});
