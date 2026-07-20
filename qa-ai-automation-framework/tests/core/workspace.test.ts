import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ArtifactError } from "../../src/core/errors.js";
import { createWorkspace, Workspace } from "../../src/core/workspace.js";

let tempRoot: string;

beforeEach(() => {
  tempRoot = mkdtempSync(join(tmpdir(), "qa-ai-ws-"));
});

afterEach(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

describe("createWorkspace", () => {
  it("resolves precedence: CLI flag > config workspace_dir > .qa default", () => {
    expect(
      createWorkspace({ cliWorkspace: "cli-ws", configWorkspaceDir: "cfg-ws", cwd: tempRoot }).root,
    ).toBe(resolve(tempRoot, "cli-ws"));
    expect(createWorkspace({ configWorkspaceDir: "cfg-ws", cwd: tempRoot }).root).toBe(
      resolve(tempRoot, "cfg-ws"),
    );
    expect(createWorkspace({ cwd: tempRoot }).root).toBe(resolve(tempRoot, ".qa"));
  });

  it("keeps absolute workspace dirs as-is", () => {
    const absolute = join(tempRoot, "elsewhere");
    expect(createWorkspace({ cliWorkspace: absolute, cwd: tempRoot }).root).toBe(absolute);
  });
});

describe("Workspace", () => {
  it("ensureDir creates nested directories and returns the absolute path", () => {
    const ws = new Workspace(join(tempRoot, ".qa"));
    const dir = ws.ensureDir("runs", "run-x", "evidence");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(ws.root, "runs", "run-x", "evidence"));
  });

  it("latest.json pointers round-trip and store workspace-relative paths", () => {
    const ws = new Workspace(join(tempRoot, ".qa"));
    const planPath = join(ws.ensureDir("plans"), "plan-20260720-120000.json");
    writeFileSync(planPath, "{}", "utf8");

    ws.writeLatestPointer("plans", planPath);

    const pointerRaw = JSON.parse(readFileSync(join(ws.root, "plans", "latest.json"), "utf8")) as {
      path: string;
    };
    expect(pointerRaw.path).toBe("plans/plan-20260720-120000.json");
    expect(ws.readLatestPointer("plans")).toBe(planPath);
  });

  it("readLatestPointer returns null when no pointer exists", () => {
    const ws = new Workspace(join(tempRoot, ".qa"));
    expect(ws.readLatestPointer("runs")).toBeNull();
  });

  it("rejects corrupt and malformed pointers with ArtifactError", () => {
    const ws = new Workspace(join(tempRoot, ".qa"));
    mkdirSync(join(ws.root, "plans"), { recursive: true });
    writeFileSync(join(ws.root, "plans", "latest.json"), "not json", "utf8");
    expect(() => ws.readLatestPointer("plans")).toThrow(ArtifactError);

    writeFileSync(join(ws.root, "plans", "latest.json"), '{"file": "wrong-key.json"}', "utf8");
    expect(() => ws.readLatestPointer("plans")).toThrow(ArtifactError);
  });
});
