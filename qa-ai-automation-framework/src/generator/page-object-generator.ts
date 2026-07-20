/**
 * Page-object generation (plan §6.4; PHASE_5_GENERATOR_PLAN §2). One
 * `completeJson` call per targeted SiteModel page. Locators are derived from
 * the page's ElementModel/form data (selector, role, accessible name,
 * data-test) — never from a prior run. Returns the generated file(s).
 */

import type { RunContext } from "../core/run-context.js";
import type { PageModel } from "../schemas/site-model.js";
import {
  buildPageObjectPrompt,
  GeneratedFilesSchema,
  PAGE_OBJECT_SYSTEM_PROMPT,
} from "./prompts.js";
import type { GeneratedFiles } from "./prompts.js";

const MAX_ELEMENTS = 40;
const MAX_TEXT_CHARS = 60;

/**
 * Condense a PageModel to the fields the model needs to build locators, so the
 * prompt never carries the raw SiteModel page (anti-pattern, plan §10).
 * Interactive elements first; forms in full.
 */
export function condensePage(page: PageModel): string {
  const interactive = page.elements.filter((e) => e.is_interactive);
  const rest = page.elements.filter((e) => !e.is_interactive);
  const elements = [...interactive, ...rest].slice(0, MAX_ELEMENTS).map((e) => ({
    tag: e.tag,
    selector: e.selector,
    role: e.role,
    type: e.element_type,
    text: e.text_content.slice(0, MAX_TEXT_CHARS),
    // Surface the attributes that drive getByLabel/getByPlaceholder/getByTestId.
    attributes: pickLocatorAttributes(e.attributes),
  }));

  return JSON.stringify(
    {
      page_id: page.page_id,
      url: page.url,
      page_type: page.page_type,
      title: page.title,
      forms: page.forms.map((form) => ({
        method: form.method,
        submit_selector: form.submit_selector,
        fields: form.fields.map((f) => ({
          name: f.name,
          type: f.field_type,
          required: f.required,
          selector: f.selector,
          ...(f.options === null ? {} : { options: f.options }),
        })),
      })),
      elements,
    },
    null,
    2,
  );
}

const LOCATOR_ATTRS = new Set([
  "id",
  "name",
  "type",
  "placeholder",
  "aria-label",
  "aria-labelledby",
  "title",
  "alt",
  "data-test",
  "data-testid",
  "data-test-id",
  "for",
  "value",
]);

function pickLocatorAttributes(attributes: Record<string, string>): Record<string, string> {
  const picked: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (LOCATOR_ATTRS.has(key)) {
      picked[key] = value;
    }
  }
  return picked;
}

/** Generate the Page Object file(s) for a single page. */
export async function generatePageObject(
  ctx: RunContext,
  page: PageModel,
  baseUrl: string,
): Promise<GeneratedFiles> {
  if (ctx.llm === undefined) {
    throw new Error("Page-object generation requires an LLM provider.");
  }
  const prompt = buildPageObjectPrompt({ pageJson: condensePage(page), baseUrl });
  const result = await ctx.llm.completeJson(
    { purpose: "generator", prompt, system: PAGE_OBJECT_SYSTEM_PROMPT },
    GeneratedFilesSchema,
  );
  return result;
}
