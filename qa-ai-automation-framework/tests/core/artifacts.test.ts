import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readArtifact, resolveArtifactPath, writeArtifact } from "../../src/core/artifacts.js";
import { ArtifactError } from "../../src/core/errors.js";
import { Workspace } from "../../src/core/workspace.js";
import { TestPlanSchema, type TestPlan } from "../../src/schemas/test-plan.js";

let tempRoot: string;
let ws: Workspace;

const plan: TestPlan = TestPlanSchema.parse({
  plan_id: "plan-20260720-120000",
  generated_at: "2026-07-20T12:00:00.000Z",
  target_url: "https://www.saucedemo.com",
});

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "qa-ai-artifacts-"));
  ws = new Workspace(join(tempRoot, ".qa"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("writeArtifact / readArtifact", () => {
  it("round-trips an artifact and stamps the envelope", () => {
    const path = join(ws.root, "plans", "plan-20260720-120000.json");
    writeArtifact({
      schema: TestPlanSchema,
      kind: "test-plan",
      path,
      data: plan,
      updateLatest: { workspace: ws, dir: "plans" },
    });

    const onDisk = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(onDisk.schema_version).toBe("1.0.0");
    expect(onDisk.generated_by).toMatch(/^qa-ai@/);

    const roundTripped = readArtifact(TestPlanSchema, path, "test-plan");
    expect(roundTripped.plan_id).toBe(plan.plan_id);
    expect(ws.readLatestPointer("plans")).toBe(path);
  });

  it("refuses to write data that fails the schema", () => {
    const bad = { ...plan, test_cases: [{ name: "missing test_id" }] } as unknown as TestPlan;
    expect(() =>
      writeArtifact({
        schema: TestPlanSchema,
        kind: "test-plan",
        path: join(ws.root, "plans", "bad.json"),
        data: bad,
      }),
    ).toThrow(ArtifactError);
  });

  it("rejects a major schema_version mismatch on read", () => {
    const path = join(ws.root, "plans", "old.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...plan, schema_version: "2.0.0" }), "utf8");
    expect(() => readArtifact(TestPlanSchema, path, "test-plan")).toThrow(/version mismatch/i);
  });

  it("accepts a minor schema_version difference on read", () => {
    const path = join(ws.root, "plans", "minor.json");
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ ...plan, schema_version: "1.7.3" }), "utf8");
    expect(readArtifact(TestPlanSchema, path, "test-plan").plan_id).toBe(plan.plan_id);
  });

  it("reports missing files, bad JSON, and schema violations as ArtifactError", () => {
    expect(() => readArtifact(TestPlanSchema, join(ws.root, "nope.json"))).toThrow(ArtifactError);

    const badJson = join(ws.root, "bad.json");
    mkdirSync(dirname(badJson), { recursive: true });
    writeFileSync(badJson, "{ not json", "utf8");
    expect(() => readArtifact(TestPlanSchema, badJson)).toThrow(/not valid JSON/);

    const badShape = join(ws.root, "shape.json");
    writeFileSync(badShape, JSON.stringify({ plan_id: 42 }), "utf8");
    expect(() => readArtifact(TestPlanSchema, badShape, "test-plan")).toThrow(/validation/);
  });
});

describe("resolveArtifactPath", () => {
  it("prefers the explicit flag, then the latest.json pointer, then errors", () => {
    const explicit = join(tempRoot, "explicit.json");
    expect(
      resolveArtifactPath({
        explicitPath: explicit,
        workspace: ws,
        latestDir: "plans",
        artifactName: "test plan",
        producingCommand: "qa-ai plan",
      }),
    ).toBe(explicit);

    const planPath = join(ws.ensureDir("plans"), "plan-x.json");
    writeFileSync(planPath, "{}", "utf8");
    ws.writeLatestPointer("plans", planPath);
    expect(
      resolveArtifactPath({
        workspace: ws,
        latestDir: "plans",
        artifactName: "test plan",
        producingCommand: "qa-ai plan",
      }),
    ).toBe(planPath);
  });

  it("errors naming the prerequisite command when nothing is found", () => {
    expect(() =>
      resolveArtifactPath({
        workspace: ws,
        latestDir: "runs",
        artifactName: "run result",
        producingCommand: "qa-ai execute",
      }),
    ).toThrow(/qa-ai execute/);
  });
});
