/**
 * Deterministic fallback planner (plan §6.2). Runs when no LLM is available or
 * the LLM plan fails — so `qa-ai plan` always yields a usable TestPlan. Per
 * page: a load+title assertion, one form fill/submit (if any form), and one
 * nav click (if an interactive link/button exists). Flags
 * `coverage_intent.fallback = true`. Port of the Python
 * `Planner._generate_fallback_plan`, minus visual tests (reserved — plan §10).
 */

import { newPlanId } from "../core/ids.js";
import type { FrameworkConfig } from "../schemas/config.js";
import type { PageModel, SiteModel } from "../schemas/site-model.js";
import type { Action, Assertion, TestCase, TestPlan } from "../schemas/test-plan.js";
import { deriveCoverageSignature } from "./plan-validator.js";

/** First word of a title, usable as a short page_title_contains keyword. */
function titleKeyword(title: string): string | null {
  const word = title.trim().split(/\s+/)[0] ?? "";
  return word.length >= 2 && word.length <= 30 ? word : null;
}

/** Realistic-ish test value for a form field, keyed on type then name (port of `_test_value_for_type`). */
function testValueForField(fieldType: string, name: string): string {
  const n = name.toLowerCase();
  if (fieldType === "email" || n.includes("email")) {
    return "test@example.com";
  }
  if (fieldType === "password" || n.includes("password")) {
    return "TestP@ssw0rd123";
  }
  if (n.includes("phone") || n.includes("tel")) {
    return "+1-555-000-1234";
  }
  if (n.includes("name")) {
    return "Test User";
  }
  if (n.includes("url") || n.includes("website")) {
    return "https://example.com";
  }
  if (n.includes("zip") || n.includes("postal")) {
    return "90210";
  }
  return "Test input value";
}

function loadTest(page: PageModel, tcNum: number, requiresAuth: boolean): TestCase {
  const assertions: Assertion[] = [
    {
      assertion_type: "page_loaded",
      selector: null,
      expected_value: null,
      tolerance: null,
      description: "Page loaded and is not blank",
    },
    {
      assertion_type: "no_console_errors",
      selector: null,
      expected_value: null,
      tolerance: null,
      description: "No console errors on load",
    },
  ];
  const keyword = titleKeyword(page.title);
  if (keyword !== null) {
    assertions.push({
      assertion_type: "page_title_contains",
      selector: null,
      expected_value: keyword,
      tolerance: null,
      description: `Title contains '${keyword}'`,
    });
  }
  return finalize({
    test_id: `tc_fallback_${String(tcNum).padStart(3, "0")}`,
    name: `Load ${page.title || page.url}`,
    description: `Verify ${page.url} loads successfully`,
    category: "functional",
    priority: 3,
    target_page_id: page.page_id,
    coverage_signature: "",
    requires_auth: requiresAuth,
    preconditions: [],
    steps: [
      {
        action_type: "navigate",
        selector: null,
        value: page.url,
        description: `Go to ${page.url}`,
      },
    ],
    assertions,
    timeout_seconds: 30,
  });
}

function formTest(page: PageModel, tcNum: number, requiresAuth: boolean): TestCase | null {
  const form = page.forms[0];
  if (form === undefined) {
    return null;
  }
  const steps: Action[] = [
    { action_type: "navigate", selector: null, value: page.url, description: `Go to ${page.url}` },
  ];
  for (const field of form.fields) {
    if (field.selector === "") {
      continue;
    }
    if (["text", "email", "password", "textarea"].includes(field.field_type)) {
      steps.push({
        action_type: "fill",
        selector: field.selector,
        value: testValueForField(field.field_type, field.name),
        description: `Fill ${field.name}`,
      });
    } else if (field.field_type === "select" && field.options && field.options.length > 0) {
      steps.push({
        action_type: "select",
        selector: field.selector,
        value: field.options[0] ?? "",
        description: `Select ${field.name}`,
      });
    } else if (field.field_type === "checkbox") {
      steps.push({
        action_type: "click",
        selector: field.selector,
        value: null,
        description: `Check ${field.name}`,
      });
    }
  }
  if (form.submit_selector !== "") {
    steps.push({
      action_type: "click",
      selector: form.submit_selector,
      value: null,
      description: "Submit form",
    });
  }
  // Only a navigate step means no fillable fields were found — not worth a case.
  if (steps.length < 2) {
    return null;
  }
  return finalize({
    test_id: `tc_fallback_${String(tcNum).padStart(3, "0")}`,
    name: `Submit form on ${page.title || page.url}`,
    description: `Fill and submit the form on ${page.url}`,
    category: "functional",
    priority: 2,
    target_page_id: page.page_id,
    coverage_signature: "",
    requires_auth: requiresAuth,
    preconditions: [],
    steps,
    assertions: [
      {
        assertion_type: "no_console_errors",
        selector: null,
        expected_value: null,
        tolerance: null,
        description: "No console errors after submission",
      },
    ],
    timeout_seconds: 30,
  });
}

function navClickTest(page: PageModel, tcNum: number, requiresAuth: boolean): TestCase | null {
  const link = page.elements.find(
    (e) => e.is_interactive && (e.element_type === "link" || e.element_type === "button"),
  );
  if (link === undefined || link.selector === "") {
    return null;
  }
  return finalize({
    test_id: `tc_fallback_${String(tcNum).padStart(3, "0")}`,
    name: `Click ${link.text_content || link.element_type} on ${page.title || page.url}`,
    description: `Click a primary ${link.element_type} and verify the page responds`,
    category: "functional",
    priority: 4,
    target_page_id: page.page_id,
    coverage_signature: "",
    requires_auth: requiresAuth,
    preconditions: [],
    steps: [
      { action_type: "navigate", selector: null, value: page.url, description: `Go to ${page.url}` },
      {
        action_type: "click",
        selector: link.selector,
        value: null,
        description: `Click ${link.text_content || link.element_type}`,
      },
    ],
    assertions: [
      {
        assertion_type: "page_loaded",
        selector: null,
        expected_value: null,
        tolerance: null,
        description: "Page loaded after click",
      },
    ],
    timeout_seconds: 30,
  });
}

/** Derive the coverage signature for a fully-formed case. */
function finalize(tc: TestCase): TestCase {
  return { ...tc, coverage_signature: deriveCoverageSignature(tc) };
}

/**
 * Build a deterministic TestPlan with no LLM (plan §6.2). Capped at
 * `max_tests_per_run`; flags `coverage_intent.fallback = true`.
 */
export function generateFallbackPlan(siteModel: SiteModel, config: FrameworkConfig): TestPlan {
  const cases: TestCase[] = [];
  let tcNum = 0;
  const nextNum = (): number => (tcNum += 1);

  for (const page of siteModel.pages) {
    const requiresAuth = page.auth_required !== false;
    cases.push(loadTest(page, nextNum(), requiresAuth));

    const form = formTest(page, tcNum + 1, requiresAuth);
    if (form !== null) {
      nextNum();
      cases.push(form);
    }

    const nav = navClickTest(page, tcNum + 1, requiresAuth);
    if (nav !== null) {
      nextNum();
      cases.push(nav);
    }
  }

  const capped = cases.slice(0, config.max_tests_per_run);
  return {
    plan_id: newPlanId(),
    generated_at: new Date().toISOString(),
    target_url: siteModel.base_url,
    test_cases: capped,
    estimated_duration_seconds: capped.length * 15,
    coverage_intent: { fallback: true, requested_categories: config.categories },
  };
}
