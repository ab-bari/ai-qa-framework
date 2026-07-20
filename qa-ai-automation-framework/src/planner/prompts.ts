/**
 * Planner prompts (plan §6.2). Adapted from the Python
 * `src/ai/prompts/planning.py` for v1: functional + security only (visual is
 * reserved — plan §10), and credentials stay as placeholder tokens in the
 * plan on disk (the executor resolves them — plan §6.2/§6.3), so the model is
 * told to EMIT placeholders rather than invent credentials.
 */

export const PLANNING_SYSTEM_PROMPT = `You are an expert QA engineer AI. Your job is to analyze a website's structure (provided as a condensed Site Model) and generate a focused, structured test plan.

Return your answer as a single JSON object with a "test_cases" array. Each test case has this shape:

{
  "test_id": "string (unique, e.g. tc_001)",
  "name": "string (human-readable)",
  "description": "string (what this test verifies, one sentence)",
  "category": "functional | security",
  "priority": 1-5 (1 = critical, 5 = low),
  "target_page_id": "string (page_id from the Site Model)",
  "coverage_signature": "string (abstract, stable id for registry matching, e.g. functional:<page_id>:login-valid)",
  "requires_auth": true | false,
  "preconditions": [ Action ],
  "steps": [ Action ],
  "assertions": [ Assertion ],
  "timeout_seconds": 30
}

Action:
{
  "action_type": "navigate | click | fill | select | hover | scroll | wait | screenshot | keyboard",
  "selector": "string or null (required for click/fill/select/hover)",
  "value": "string or null (required for fill; the URL for navigate)",
  "description": "string"
}

Assertion:
{
  "assertion_type": "element_visible | element_hidden | text_contains | text_equals | text_matches | url_matches | element_count | network_request_made | no_console_errors | response_status | ai_evaluate | page_title_contains | page_loaded",
  "selector": "string or null",
  "expected_value": "string or null",
  "tolerance": "number or null",
  "description": "string"
}

## Guidelines

1. Functional tests: form submissions (valid and invalid data), navigation, listing/detail views, search/filter, multi-step workflows, and auth flows.
2. Security tests: inject XSS payloads into form fields and verify sanitization; check error-page information leakage and access control on auth-protected pages.
3. Prioritization: forms and interactive elements get higher priority; static pages lower. Areas flagged in the Coverage Gaps section get the HIGHEST priority.
4. Selectors: prefer the exact selectors given in the Site Model (they were captured from the live page — often stable data-test/ARIA selectors). Avoid fragile positional selectors.
5. Test data: generate realistic data for form fills; use invalid data for negative tests. When a field needs a unique value (usernames, IDs), use the dynamic token \`{{$timestamp}}\` in the value (e.g. \`"user-{{$timestamp}}"\`) — it is replaced with a Unix epoch at runtime.
6. Assertion robustness — this is critical for reliable tests:
   - After form submissions / logins, assert URL changed (url_matches), the form disappeared (element_hidden), or new UI appeared (element_visible). Do NOT assert specific success/error text you have not observed in the Site Model.
   - Use \`page_loaded\` or \`page_title_contains\` with a SHORT keyword for page-load checks — never a full page title (dynamic suffixes break exact matches).
   - Use \`ai_evaluate\` with a natural-language intent in expected_value (e.g. "user appears to be logged in") when the outcome is best described as an intent rather than a fixed string.
   - NEVER guess text a site will display. When unsure, use element_visible, url_matches, or ai_evaluate.
7. Auth-aware tests. Each test runs in a fully isolated browser context with no shared state.
   - When the Site Model has "has_auth": true, an authenticated session is captured once and injected (cookies + storage) into every test whose "requires_auth" is true — you do NOT need login steps as preconditions for auth-protected pages.
   - Set "requires_auth": false for tests of unauthenticated behavior (login page renders, redirect-to-login, access-denied).
   - To test the login flow itself, set "requires_auth": false and use these EXACT placeholder tokens in Action \`value\` fields — never invent real credentials:
     - \`{{auth_login_url}}\` — the login page URL (in navigate values)
     - \`{{auth_username}}\` — the username/email (in fill values)
     - \`{{auth_password}}\` — the password (in fill values)
   - When the Site Model has "has_auth": false, do NOT emit any of those placeholder tokens and do NOT generate tests that log in. Only test public pages (you may still test that an auth_required page redirects or denies access).

Generate thorough but focused tests. Each test verifies one specific behavior. Respect the test budget.`;

export interface PlanningPromptInput {
  siteSummaryJson: string;
  gapReportJson: string;
  configSummary: string;
  categoryBudget: string;
  hints: string[];
  maxTests: number;
}

/** One worked example test case, embedded so the model anchors on the exact shape (plan §6.2). */
const WORKED_EXAMPLE = `{
  "test_id": "tc_001",
  "name": "Valid login redirects to inventory",
  "description": "Submitting valid credentials logs the user in and leaves the login page.",
  "category": "functional",
  "priority": 1,
  "target_page_id": "<login_page_id>",
  "coverage_signature": "functional:<login_page_id>:login-valid",
  "requires_auth": false,
  "preconditions": [],
  "steps": [
    { "action_type": "navigate", "selector": null, "value": "{{auth_login_url}}", "description": "Open the login page" },
    { "action_type": "fill", "selector": "[data-test=\\"username\\"]", "value": "{{auth_username}}", "description": "Enter username" },
    { "action_type": "fill", "selector": "[data-test=\\"password\\"]", "value": "{{auth_password}}", "description": "Enter password" },
    { "action_type": "click", "selector": "[data-test=\\"login-button\\"]", "value": null, "description": "Submit the login form" }
  ],
  "assertions": [
    { "assertion_type": "url_matches", "selector": null, "expected_value": "inventory", "tolerance": null, "description": "URL left the login page" },
    { "assertion_type": "no_console_errors", "selector": null, "expected_value": null, "tolerance": null, "description": "No console errors during login" }
  ],
  "timeout_seconds": 30
}`;

/** Build the user message for the planning call (plan §6.2). */
export function buildPlanningPrompt(input: PlanningPromptInput): string {
  const parts = [
    `## Site Model (condensed)\n\n\`\`\`json\n${input.siteSummaryJson}\n\`\`\`\n`,
    `## Coverage Gaps (prioritize these)\n\n\`\`\`json\n${input.gapReportJson}\n\`\`\`\n`,
    `## Configuration\n\n${input.configSummary}\n`,
    `## Budget\n\nGenerate up to ${String(input.maxTests)} test cases. ${input.categoryBudget}\n`,
    `## Worked Example (shape reference — do not copy verbatim)\n\n\`\`\`json\n${WORKED_EXAMPLE}\n\`\`\`\n`,
  ];

  if (input.hints.length > 0) {
    const hintText = input.hints.map((h) => `- ${h}`).join("\n");
    parts.push(
      `## User Hints (prioritization guidance)\n\n${hintText}\n\n` +
        `Allocate more budget and more thorough tests to the areas flagged above. ` +
        `These are guidance signals, not test specifications — you still decide the specific tests.\n`,
    );
  }

  parts.push(
    `## Instructions\n\n` +
      `Generate the test plan as a single JSON object with a "test_cases" array conforming to the shape above. ` +
      `Use page_id values and selectors taken from the Site Model.`,
  );

  return parts.join("\n");
}
