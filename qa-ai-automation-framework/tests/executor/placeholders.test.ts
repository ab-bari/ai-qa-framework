import { describe, expect, it } from "vitest";

import {
  buildPlaceholderContext,
  maskSecrets,
  resolveTestCase,
  resolveText,
} from "../../src/executor/placeholders.js";
import { AuthConfigSchema } from "../../src/schemas/config.js";
import { TestCaseSchema } from "../../src/schemas/test-plan.js";

function auth() {
  return AuthConfigSchema.parse({
    login_url: "https://www.saucedemo.com/",
    username: "standard_user",
    password: "secret_sauce",
  });
}

describe("buildPlaceholderContext", () => {
  it("exposes auth credentials and a dynamic timestamp", () => {
    const ctx = buildPlaceholderContext(auth(), new Date("2026-07-20T12:00:00.000Z"));
    expect(ctx.values.get("auth_username")).toBe("standard_user");
    expect(ctx.values.get("auth_password")).toBe("secret_sauce");
    expect(ctx.values.get("auth_login_url")).toBe("https://www.saucedemo.com/");
    expect(ctx.values.get("$timestamp")).toBe(String(Date.UTC(2026, 6, 20, 12) / 1000));
    expect(ctx.secrets).toContain("secret_sauce");
  });

  it("omits auth tokens (and secrets) when no auth is configured", () => {
    const ctx = buildPlaceholderContext(null);
    expect(ctx.values.has("auth_username")).toBe(false);
    expect(ctx.secrets).toEqual([]);
  });
});

describe("resolveText", () => {
  it("substitutes known tokens", () => {
    const ctx = buildPlaceholderContext(auth());
    expect(resolveText("{{auth_username}}", ctx).text).toBe("standard_user");
  });

  it("leaves unknown tokens intact and reports them", () => {
    const ctx = buildPlaceholderContext(auth());
    const result = resolveText("hi {{mystery}} there", ctx);
    expect(result.text).toBe("hi {{mystery}} there");
    expect(result.unresolved).toEqual(["mystery"]);
  });

  it("uses one timestamp snapshot across every token in a test case", () => {
    const ctx = buildPlaceholderContext(null);
    const result = resolveText("{{$timestamp}}-{{$timestamp}}", ctx);
    const [first, second] = result.text.split("-");
    expect(first).toBe(second);
  });
});

describe("resolveTestCase", () => {
  const testCase = TestCaseSchema.parse({
    test_id: "TC-001",
    name: "login",
    preconditions: [{ action_type: "navigate", value: "{{auth_login_url}}" }],
    steps: [
      { action_type: "fill", selector: "#user", value: "{{auth_username}}" },
      { action_type: "fill", selector: "#pass", value: "{{auth_password}}" },
    ],
    assertions: [{ assertion_type: "text_contains", expected_value: "{{auth_username}}" }],
  });

  it("resolves preconditions, steps and assertions", () => {
    const resolved = resolveTestCase(testCase, buildPlaceholderContext(auth()));
    expect(resolved.preconditions[0]?.value).toBe("https://www.saucedemo.com/");
    expect(resolved.steps[0]?.value).toBe("standard_user");
    expect(resolved.steps[1]?.value).toBe("secret_sauce");
    expect(resolved.assertions[0]?.expected_value).toBe("standard_user");
  });

  it("does not mutate the plan — the artifact stays credential-free", () => {
    resolveTestCase(testCase, buildPlaceholderContext(auth()));
    expect(testCase.steps[1]?.value).toBe("{{auth_password}}");
  });
});

describe("maskSecrets", () => {
  it("replaces every occurrence of a secret", () => {
    expect(maskSecrets("login failed for secret_sauce/secret_sauce", ["secret_sauce"])).toBe(
      "login failed for ***/***",
    );
  });

  it("ignores very short secrets to avoid mangling unrelated text", () => {
    expect(maskSecrets("abc def", ["ab"])).toBe("abc def");
  });
});
