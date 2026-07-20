/**
 * Assertion checks that need no browser. Page-touching assertion types are
 * covered by the integration suite; these pin the pure decision logic —
 * especially `no_console_errors`, whose filtering rules decide whether the
 * assertion is usable on a real site at all.
 */

import { describe, expect, it } from "vitest";

import { createLogger } from "../../src/core/logger.js";
import { checkAssertion, type AssertionContext } from "../../src/executor/assertions.js";
import type { NetworkEntry } from "../../src/executor/evidence.js";
import { AssertionSchema } from "../../src/schemas/test-plan.js";

const logger = createLogger({ level: "error" });

function context(overrides: Partial<AssertionContext> = {}): AssertionContext {
  return {
    // Only the non-page assertions are exercised here.
    page: null as unknown as AssertionContext["page"],
    evidenceDir: "",
    consoleLogs: [],
    networkLog: [],
    logger,
    timeoutMs: 1000,
    ...overrides,
  };
}

function network(entries: Partial<NetworkEntry>[]): NetworkEntry[] {
  return entries.map((entry) => ({
    url: "https://www.saucedemo.com/",
    method: "GET",
    status: 200,
    resource_type: "document",
    ...entry,
  }));
}

const assertion = (fields: Record<string, unknown>) => AssertionSchema.parse(fields);

describe("no_console_errors", () => {
  const check = (consoleLogs: string[]) =>
    checkAssertion(assertion({ assertion_type: "no_console_errors" }), context({ consoleLogs }));

  it("passes on a clean console", async () => {
    expect((await check([])).status).toBe("pass");
  });

  it("ignores non-error console output, even when it says 'error'", async () => {
    const outcome = await check(["[log] retrying after error", "[warning] deprecated"]);
    expect(outcome.status).toBe("pass");
  });

  it("fails on a real page-script error", async () => {
    const outcome = await check(["[error] Uncaught TypeError: x is not a function"]);
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("Uncaught TypeError");
  });

  it("excludes sub-resource load failures but reports how many", async () => {
    const outcome = await check([
      "[error] Failed to load resource: the server responded with a status of 404 ()",
      "[error] Failed to load resource: the server responded with a status of 401 (Unauthorized)",
    ]);
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("2 resource-load error(s) excluded");
  });

  it("excludes CORS-blocked third-party requests", async () => {
    const outcome = await check([
      "[error] Access to fetch at 'https://submit.backtrace.io/x/json' from origin " +
        "'https://www.saucedemo.com' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header",
    ]);
    expect(outcome.status).toBe("pass");
    expect(outcome.message).toContain("1 resource-load error(s) excluded");
  });

  it("still fails when a real error accompanies resource noise", async () => {
    const outcome = await check([
      "[error] Failed to load resource: the server responded with a status of 404 ()",
      "[error] Uncaught ReferenceError: foo is not defined",
    ]);
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("1 console error(s)");
    expect(outcome.message).toContain("1 resource-load error(s) excluded");
  });
});

describe("network_request_made", () => {
  it("passes when a recorded request matches the fragment", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "network_request_made", expected_value: "/inventory" }),
      context({ networkLog: network([{ url: "https://www.saucedemo.com/inventory.html" }]) }),
    );
    expect(outcome.status).toBe("pass");
  });

  it("fails when nothing matches", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "network_request_made", expected_value: "/cart" }),
      context({ networkLog: network([{ url: "https://www.saucedemo.com/inventory.html" }]) }),
    );
    expect(outcome.status).toBe("fail");
  });

  it("fails without an expected_value rather than passing vacuously", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "network_request_made" }),
      context({ networkLog: network([{}]) }),
    );
    expect(outcome.status).toBe("fail");
  });
});

describe("response_status", () => {
  it("passes when any response carries the expected status", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "response_status", expected_value: "401" }),
      context({ networkLog: network([{ status: 200 }, { status: 401 }]) }),
    );
    expect(outcome.status).toBe("pass");
  });

  it("narrows to matching URLs when a selector is given", async () => {
    const outcome = await checkAssertion(
      assertion({
        assertion_type: "response_status",
        selector: "/cart",
        expected_value: "404",
      }),
      context({
        networkLog: network([
          { url: "https://www.saucedemo.com/inventory.html", status: 404 },
          { url: "https://www.saucedemo.com/cart.html", status: 200 },
        ]),
      }),
    );
    expect(outcome.status).toBe("fail");
  });

  it("fails on a non-numeric expected_value", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "response_status", expected_value: "ok" }),
      context({ networkLog: network([{}]) }),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("not a number");
  });
});

describe("screenshot_diff", () => {
  it("resolves to skip in v1 with an explicit reason", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "screenshot_diff" }),
      context(),
    );
    expect(outcome.status).toBe("skip");
    expect(outcome.message).toContain("SKIPPED");
  });
});

describe("ai_evaluate", () => {
  it("fails clearly when no provider is attached rather than throwing", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "ai_evaluate", expected_value: "user is logged in" }),
      context(),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("requires an LLM provider");
  });

  it("fails when no intent was supplied", async () => {
    const outcome = await checkAssertion(
      assertion({ assertion_type: "ai_evaluate" }),
      context(),
    );
    expect(outcome.status).toBe("fail");
    expect(outcome.message).toContain("requires expected_value");
  });
});
