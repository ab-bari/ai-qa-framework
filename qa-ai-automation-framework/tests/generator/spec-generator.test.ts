import { describe, expect, it } from "vitest";

import { collectEnvVars, extractTraceabilityIds } from "../../src/generator/spec-generator.js";

describe("extractTraceabilityIds", () => {
  it("pulls every qa-ai:test_id comment in order", () => {
    const content = [
      "// qa-ai:test_id=tc_001 signature=functional:login:valid",
      "test('a', async () => {});",
      "// qa-ai:test_id=tc_002 signature=functional:login:invalid",
      "test('b', async () => {});",
    ].join("\n");
    expect(extractTraceabilityIds(content)).toEqual(["tc_001", "tc_002"]);
  });

  it("returns empty when no traceability comments are present", () => {
    expect(extractTraceabilityIds("test('a', async () => {});")).toEqual([]);
  });
});

describe("collectEnvVars", () => {
  it("collects and sorts unique process.env reads", () => {
    const files = [
      { content: "process.env.QA_PASSWORD ?? ''" },
      { content: "process.env.QA_USERNAME; process.env.QA_PASSWORD" },
    ];
    expect(collectEnvVars(files)).toEqual(["QA_PASSWORD", "QA_USERNAME"]);
  });
});
