import { describe, expect, it } from "vitest";

import {
  FailureTriageSchema,
  HealedTestSchema,
  HealingReportSchema,
} from "../../src/schemas/healing-report.js";

describe("HealingReportSchema", () => {
  it("parses a full healing session and survives a JSON round-trip", () => {
    const report = {
      session_id: "session-20260720-140000",
      automation_run_path: ".qa/automation-runs/run-20260720-133000",
      started_at: "2026-07-20T14:00:00.000Z",
      completed_at: "2026-07-20T14:06:40.000Z",
      tests_considered: 2,
      tests_healed: 1,
      tests_unhealable: 1,
      summary: "Healed one locator failure; one suspected app bug reported without patching.",
      healed_tests: [
        {
          source_test_id: "TC-002",
          spec_file: "tests/inventory/inventory-page.spec.ts",
          test_title: "adds an item to the cart @regression",
          triage: {
            test_ref: "inventory-page.spec.ts › adds an item to the cart @regression",
            classification: "locator",
            healable: true,
            reasoning: "Locator timeout on a button whose accessible name changed.",
          },
          attempts: [
            {
              attempt_no: 1,
              patches: [
                {
                  file_path: "src/pages/InventoryPage.ts",
                  backup_path: "backups/src/pages/InventoryPage.ts.attempt-1",
                  diff_path: "diffs/InventoryPage.ts.attempt-1.diff",
                  diff_unified:
                    "--- a/src/pages/InventoryPage.ts\n+++ b/src/pages/InventoryPage.ts\n@@ -21 +21 @@\n-getByRole('button', { name: 'Add to cart' })\n+getByRole('button', { name: 'Add to Cart' })",
                  attempt: 1,
                  description: "Update accessible name casing",
                },
              ],
              verify_status: "pass",
              verify_error: null,
            },
          ],
          final_status: "healed",
        },
        {
          source_test_id: "TC-005",
          spec_file: "tests/checkout/checkout.spec.ts",
          test_title: "completes checkout @critical",
          triage: {
            test_ref: "checkout.spec.ts › completes checkout @critical",
            classification: "app_bug",
            healable: false,
            reasoning: "Server responds 500 on /checkout; confirmed against live DOM.",
          },
          attempts: [],
          final_status: "app_bug_suspected",
        },
      ],
    };
    const parsed = HealingReportSchema.parse(report);
    expect(parsed.healed_tests[0]?.attempts[0]?.patches[0]?.attempt).toBe(1);
    expect(parsed.healed_tests[1]?.final_status).toBe("app_bug_suspected");
    const reparsed = HealingReportSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("rejects unknown classifications and final statuses", () => {
    expect(
      FailureTriageSchema.safeParse({
        test_ref: "x",
        classification: "cosmic_rays",
        healable: false,
      }).success,
    ).toBe(false);
    expect(
      HealedTestSchema.safeParse({
        spec_file: "a.spec.ts",
        test_title: "t",
        triage: { test_ref: "x", classification: "locator", healable: true },
        final_status: "partially_healed",
      }).success,
    ).toBe(false);
  });

  it("defaults attempt verify_status to not_run", () => {
    const healed = HealedTestSchema.parse({
      spec_file: "a.spec.ts",
      test_title: "t",
      triage: { test_ref: "x", classification: "navigation", healable: true },
      attempts: [{ attempt_no: 1 }],
      final_status: "gave_up",
    });
    expect(healed.attempts[0]?.verify_status).toBe("not_run");
    expect(healed.source_test_id).toBe("");
  });
});
