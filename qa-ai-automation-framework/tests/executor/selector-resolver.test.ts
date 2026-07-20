import { describe, expect, it } from "vitest";

import {
  deriveCandidateSpecs,
  describeCandidate,
  findElementForSelector,
  relaxCssSelector,
} from "../../src/executor/selector-resolver.js";
import { ElementModelSchema, type ElementModel } from "../../src/schemas/site-model.js";

function element(overrides: Partial<ElementModel> = {}): ElementModel {
  return ElementModelSchema.parse({
    element_id: "e1",
    tag: "input",
    selector: "#user-name",
    ...overrides,
  });
}

describe("findElementForSelector", () => {
  it("matches on the recorded selector, ignoring surrounding whitespace", () => {
    const elements = [element({ selector: " #user-name " })];
    expect(findElementForSelector(elements, "#user-name")?.element_id).toBe("e1");
  });

  it("returns undefined when the plan selector is not in the site model", () => {
    expect(findElementForSelector([element()], "#nope")).toBeUndefined();
  });
});

describe("deriveCandidateSpecs", () => {
  it("derives real Playwright locators from element attributes, in priority order", () => {
    const specs = deriveCandidateSpecs(
      "#login-button",
      element({
        tag: "input",
        selector: "#login-button",
        text_content: "Login",
        attributes: {
          type: "submit",
          id: "login-button",
          name: "login",
          "data-test": "login-button",
          "aria-label": "Log in",
        },
      }),
      "click",
    );
    expect(specs.map((spec) => spec.strategy)).toEqual([
      "role_name",
      "aria_label",
      "data_test_attr",
      "text",
      "id_attr",
      "name_attr",
    ]);
    expect(specs[0]).toEqual({
      strategy: "role_name",
      via: "role",
      role: "button",
      name: "Log in",
    });
    expect(specs.map(describeCandidate)).toContain("getByRole('button', { name: 'Log in' })");
  });

  it("uses getByTestId for data-testid and an attribute selector for data-test", () => {
    const specs = deriveCandidateSpecs(
      "#x",
      element({ attributes: { "data-testid": "username", "data-test": "username" } }),
      "fill",
    );
    expect(specs).toContainEqual({ strategy: "test_id", via: "testId", value: "username" });
    expect(specs).toContainEqual({
      strategy: "data_test_attr",
      via: "css",
      value: '[data-test="username"]',
    });
  });

  it("gives password inputs no implicit role (they have none in ARIA)", () => {
    const specs = deriveCandidateSpecs(
      "#password",
      element({ attributes: { type: "password", id: "password" } }),
      "fill",
    );
    expect(specs.some((spec) => spec.via === "role")).toBe(false);
  });

  it("only offers a text locator for click/hover or link elements", () => {
    const fillSpecs = deriveCandidateSpecs(
      "#f",
      element({ tag: "input", text_content: "Submit", attributes: { type: "text" } }),
      "fill",
    );
    expect(fillSpecs.some((spec) => spec.via === "text")).toBe(false);

    const clickSpecs = deriveCandidateSpecs(
      "#c",
      element({ tag: "div", text_content: "Submit" }),
      "click",
    );
    expect(clickSpecs).toContainEqual({ strategy: "text", via: "text", value: "Submit" });
  });

  it("escapes quotes in attribute values", () => {
    const specs = deriveCandidateSpecs("#q", element({ attributes: { id: 'a"b' } }), "click");
    expect(specs).toContainEqual({ strategy: "id_attr", via: "css", value: '[id="a\\"b"]' });
  });

  it("never re-proposes the original selector", () => {
    const specs = deriveCandidateSpecs(
      '[data-test="username"]',
      element({ selector: '[data-test="username"]', attributes: { "data-test": "username" } }),
      "fill",
    );
    expect(specs.some((spec) => describeCandidate(spec) === '[data-test="username"]')).toBe(false);
  });

  it("falls back to a relaxed CSS selector when the site model has no element", () => {
    const specs = deriveCandidateSpecs("div.a div.b div.c form input:nth-child(2)", undefined, "fill");
    expect(specs).toEqual([{ strategy: "relaxed_css", via: "css", value: "form input" }]);
  });
});

describe("relaxCssSelector", () => {
  it("drops positional and negation pseudo-classes", () => {
    expect(relaxCssSelector("ul li:nth-child(3)")).toBe("ul li");
    expect(relaxCssSelector("div:not(.hidden)")).toBe("div");
  });

  it("keeps only the last two segments of a deeply nested selector", () => {
    expect(relaxCssSelector("a b c d e")).toBe("d e");
  });

  it("returns null when nothing could be relaxed", () => {
    expect(relaxCssSelector("#user-name")).toBeNull();
    expect(relaxCssSelector("text=Login")).toBeNull();
  });
});

describe("describeCandidate", () => {
  it("renders each locator kind the way it is written in Playwright", () => {
    expect(describeCandidate({ strategy: "s", via: "role", role: "link", name: null })).toBe(
      "getByRole('link')",
    );
    expect(describeCandidate({ strategy: "s", via: "label", value: "Email" })).toBe(
      "getByLabel('Email')",
    );
    expect(describeCandidate({ strategy: "s", via: "placeholder", value: "Search" })).toBe(
      "getByPlaceholder('Search')",
    );
    expect(describeCandidate({ strategy: "s", via: "text", value: "Go" })).toBe("getByText('Go')");
    expect(describeCandidate({ strategy: "s", via: "css", value: "#a" })).toBe("#a");
  });
});
