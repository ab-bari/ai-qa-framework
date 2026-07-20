import { describe, expect, it } from "vitest";

import {
  GeneratedFileSchema,
  GenerationManifestSchema,
} from "../../src/schemas/generation-manifest.js";

describe("GenerationManifestSchema", () => {
  it("parses a full manifest and survives a JSON round-trip", () => {
    const manifest = {
      plan_id: "plan-20260721-101010",
      site_model: ".qa/site-model/site-model.json",
      target_url: "https://www.saucedemo.com",
      project_dir: "D:/repo/automation-tests",
      files: [
        { path: "package.json", kind: "scaffold" },
        { path: "src/pages/LoginPage.ts", kind: "page-object", test_ids: [] },
        { path: "tests/auth/login.spec.ts", kind: "spec", test_ids: ["tc_001", "tc_002"] },
        { path: "tests/data/users.json", kind: "data" },
      ],
      repair_rounds: 1,
      lint_warnings: [],
      generated_at: "2026-07-21T10:10:10.000Z",
    };
    const parsed = GenerationManifestSchema.parse(manifest);
    expect(parsed.files[2]?.test_ids).toEqual(["tc_001", "tc_002"]);
    expect(parsed.files[0]?.test_ids).toEqual([]);
    const reparsed = GenerationManifestSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reparsed).toEqual(parsed);
  });

  it("rejects unknown file kinds", () => {
    expect(GeneratedFileSchema.safeParse({ path: "x.ts", kind: "widget" }).success).toBe(false);
  });
});
