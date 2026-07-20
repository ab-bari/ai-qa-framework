import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import type { RunContext } from "../../src/core/run-context.js";
import { createWorkspace } from "../../src/core/workspace.js";
import { FakeLlmProvider } from "../../src/llm/fake-provider.js";
import { generatePlan } from "../../src/planner/index.js";
import { FrameworkConfigSchema } from "../../src/schemas/config.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";

function makeCtx(llm: RunContext["llm"]): RunContext {
  const config = FrameworkConfigSchema.parse({
    target_url: "https://www.saucedemo.com",
    categories: ["functional", "security"],
  });
  const workspace = createWorkspace({ cliWorkspace: mkdtempSync(join(tmpdir(), "qa-plan-")) });
  return { config, workspace, logger: createLogger({ level: "error" }), llm };
}

const siteModel = SiteModelSchema.parse({
  base_url: "https://www.saucedemo.com",
  pages: [{ page_id: "login", url: "https://www.saucedemo.com/", page_type: "form" }],
});

/** A site model rich enough to yield several fallback cases (load + form + nav click). */
const multiCaseSiteModel = SiteModelSchema.parse({
  base_url: "https://www.saucedemo.com",
  pages: [
    {
      page_id: "login",
      url: "https://www.saucedemo.com/",
      page_type: "form",
      title: "Swag Labs",
      auth_required: false,
      elements: [
        {
          element_id: "e1",
          tag: "a",
          selector: "#nav",
          element_type: "link",
          text_content: "Menu",
          is_interactive: true,
        },
      ],
      forms: [
        {
          form_id: "f1",
          method: "POST",
          submit_selector: "[data-test=\"login-button\"]",
          fields: [
            { name: "user-name", field_type: "text", selector: "[data-test=\"username\"]" },
            { name: "password", field_type: "password", selector: "[data-test=\"password\"]" },
          ],
        },
      ],
    },
    {
      page_id: "inventory",
      url: "https://www.saucedemo.com/inventory.html",
      page_type: "listing",
      title: "",
      auth_required: true,
    },
  ],
});

const GOOD_RESPONSE = `\`\`\`json
{
  "test_cases": [
    {
      "test_id": "tc_001",
      "name": "Valid login",
      "category": "functional",
      "target_page_id": "login",
      "requires_auth": false,
      "steps": [
        { "action_type": "navigate", "selector": null, "value": "{{auth_login_url}}", "description": "open" }
      ],
      "assertions": [
        { "assertion_type": "page_loaded", "description": "loaded" }
      ]
    }
  ]
}
\`\`\``;

describe("generatePlan", () => {
  it("returns an AI plan when the LLM responds with valid test cases", async () => {
    const ctx = makeCtx(new FakeLlmProvider([GOOD_RESPONSE]));
    const plan = await generatePlan(ctx, siteModel);

    expect(plan.test_cases).toHaveLength(1);
    expect(plan.test_cases[0]?.test_id).toBe("tc_001");
    expect(plan.test_cases[0]?.coverage_signature).toBe("functional:login:valid-login");
    expect(plan.coverage_intent.fallback).toBe(false);
    // Credentials stay as placeholders on disk (executor resolves them).
    expect(plan.test_cases[0]?.steps[0]?.value).toBe("{{auth_login_url}}");
  });

  it("falls back to a deterministic plan when the LLM keeps failing", async () => {
    const ctx = makeCtx(new FakeLlmProvider(() => new Error("boom")));
    const plan = await generatePlan(ctx, siteModel);

    expect(plan.coverage_intent.fallback).toBe(true);
    expect(plan.test_cases.length).toBeGreaterThan(0);
  });

  it("falls back when no LLM provider is attached", async () => {
    const ctx = makeCtx(undefined);
    const plan = await generatePlan(ctx, siteModel);

    expect(plan.coverage_intent.fallback).toBe(true);
  });

  it("applies maxTests on the fallback path after the LLM throws", async () => {
    // Control: the fixture really does exceed the cap when nothing constrains it.
    const uncapped = await generatePlan(
      makeCtx(new FakeLlmProvider(() => new Error("boom"))),
      multiCaseSiteModel,
    );
    expect(uncapped.test_cases.length).toBeGreaterThan(1);

    const ctx = makeCtx(new FakeLlmProvider(() => new Error("boom")));
    const plan = await generatePlan(ctx, multiCaseSiteModel, { maxTests: 1 });

    expect(plan.coverage_intent.fallback).toBe(true);
    expect(plan.test_cases).toHaveLength(1);
  });

  it("applies maxTests on the fallback path when no LLM provider is attached", async () => {
    const ctx = makeCtx(undefined);
    const plan = await generatePlan(ctx, multiCaseSiteModel, { maxTests: 1 });

    expect(plan.coverage_intent.fallback).toBe(true);
    expect(plan.test_cases).toHaveLength(1);
  });
});
