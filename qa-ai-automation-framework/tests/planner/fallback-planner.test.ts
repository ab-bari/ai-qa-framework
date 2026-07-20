import { describe, expect, it } from "vitest";

import { generateFallbackPlan } from "../../src/planner/fallback-planner.js";
import { TestPlanSchema } from "../../src/schemas/test-plan.js";
import { FrameworkConfigSchema, type FrameworkConfig } from "../../src/schemas/config.js";
import { SiteModelSchema } from "../../src/schemas/site-model.js";

function config(overrides: Partial<FrameworkConfig> = {}): FrameworkConfig {
  return FrameworkConfigSchema.parse({ target_url: "https://www.saucedemo.com", ...overrides });
}

function siteModel() {
  return SiteModelSchema.parse({
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
}

describe("generateFallbackPlan", () => {
  it("produces a schema-valid plan flagged as fallback", () => {
    const plan = generateFallbackPlan(siteModel(), config());
    expect(() => TestPlanSchema.parse(plan)).not.toThrow();
    expect(plan.coverage_intent.fallback).toBe(true);
    expect(plan.test_cases.length).toBeGreaterThan(0);
  });

  it("emits load, form, and nav-click cases for the login page", () => {
    const plan = generateFallbackPlan(siteModel(), config());
    const loginCases = plan.test_cases.filter((tc) => tc.target_page_id === "login");
    const names = loginCases.map((tc) => tc.name);
    expect(names.some((n) => n.startsWith("Load"))).toBe(true);
    expect(names.some((n) => n.startsWith("Submit form"))).toBe(true);
    expect(names.some((n) => n.startsWith("Click"))).toBe(true);

    const formCase = loginCases.find((tc) => tc.name.startsWith("Submit form"));
    expect(formCase?.steps.some((s) => s.action_type === "fill")).toBe(true);
    expect(formCase?.steps.at(-1)?.selector).toBe("[data-test=\"login-button\"]");
  });

  it("carries auth_required through from the page model", () => {
    const plan = generateFallbackPlan(siteModel(), config());
    const inventoryLoad = plan.test_cases.find((tc) => tc.target_page_id === "inventory");
    expect(inventoryLoad?.requires_auth).toBe(true);
  });

  it("caps the plan at max_tests_per_run", () => {
    const plan = generateFallbackPlan(siteModel(), config({ max_tests_per_run: 1 }));
    expect(plan.test_cases).toHaveLength(1);
  });

  it("lets options.maxTests override max_tests_per_run", () => {
    const uncapped = generateFallbackPlan(siteModel(), config());
    expect(uncapped.test_cases.length).toBeGreaterThan(1);

    const plan = generateFallbackPlan(siteModel(), config(), { maxTests: 1 });
    expect(plan.test_cases).toHaveLength(1);
  });
});
