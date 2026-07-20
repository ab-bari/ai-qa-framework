/**
 * Per-page analysis (plan §6.1): element extraction, form analysis, page-type
 * classification, and screenshot / DOM snapshot capture. The browser-side
 * sweeps are ported verbatim from the Python `src/crawler/element_extractor.py`,
 * `form_analyzer.py`, and the `_classify_page` heuristic in `crawler.py`.
 *
 * The `page.evaluate` bodies are passed as strings with an explicit return type
 * so the browser code stays untyped (it runs in Chromium, not Node) while every
 * Node-side value remains fully typed.
 */

import { writeFileSync } from "node:fs";

import type { Page } from "playwright";

import { evalDom } from "../core/browser/eval-dom.js";
import type { Logger } from "../core/logger.js";
import { elementId, md5Hex } from "../core/ids.js";
import type { Workspace } from "../core/workspace.js";
import type { ElementModel, FormModel, PageModel } from "../schemas/site-model.js";
import type { NetworkRequest } from "../schemas/site-model.js";

interface RawElement {
  tag: string;
  selector: string;
  role: string;
  text_content: string;
  is_interactive: boolean;
  element_type: string;
  attributes: Record<string, string>;
}

interface RawFormField {
  name: string;
  field_type: string;
  required: boolean;
  validation_pattern: string | null;
  options: string[] | null;
  selector: string;
}

interface RawForm {
  action: string;
  method: string;
  fields: RawFormField[];
  submit_selector: string;
}

const EXTRACT_ELEMENTS_SCRIPT = `() => {
  const interactiveTags = new Set(['a', 'button', 'input', 'select', 'textarea', 'details', 'summary']);
  const interactiveRoles = new Set([
    'button', 'link', 'textbox', 'checkbox', 'radio', 'combobox',
    'listbox', 'menuitem', 'tab', 'switch', 'slider'
  ]);

  function getSelector(el) {
    if (el.dataset && el.dataset.testid) return '[data-testid="' + el.dataset.testid + '"]';
    if (el.dataset && el.dataset.test) return '[data-test="' + el.dataset.test + '"]';
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name && ['input', 'select', 'textarea'].includes(el.tagName.toLowerCase())) {
      return el.tagName.toLowerCase() + '[name="' + el.name + '"]';
    }
    if (el.getAttribute('aria-label')) {
      return '[aria-label="' + el.getAttribute('aria-label') + '"]';
    }
    let sel = el.tagName.toLowerCase();
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
      if (cls) sel += '.' + cls;
    }
    return sel;
  }

  function getRole(el) {
    if (el.getAttribute('role')) return el.getAttribute('role');
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button') return 'button';
    if (tag === 'input') {
      const t = el.type || 'text';
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'submit') return 'button';
      return 'textbox';
    }
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    return '';
  }

  function getElementType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || (tag === 'input' && el.type === 'submit')) return 'button';
    if (tag === 'input') return 'input';
    if (tag === 'select') return 'dropdown';
    if (tag === 'textarea') return 'textarea';
    if (el.getAttribute('role') === 'tab') return 'tab';
    if (el.getAttribute('role') === 'menuitem') return 'menuitem';
    return tag;
  }

  const results = [];
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const isClickable = el.onclick || el.getAttribute('onclick');
    const isInteractive = interactiveTags.has(tag) ||
      interactiveRoles.has(role) || !!isClickable || el.getAttribute('tabindex') === '0';
    if (!isInteractive) continue;
    if (el.offsetParent === null && !el.closest('details')) continue;

    const attrs = {};
    for (const attr of el.attributes) {
      if (['class', 'style'].includes(attr.name)) continue;
      attrs[attr.name] = attr.value;
    }
    results.push({
      tag: tag,
      selector: getSelector(el),
      role: getRole(el),
      text_content: (el.textContent || '').trim().substring(0, 100),
      is_interactive: true,
      element_type: getElementType(el),
      attributes: attrs,
    });
  }
  return results;
}`;

const ANALYZE_FORMS_SCRIPT = `() => {
  const forms = document.querySelectorAll('form');
  return Array.from(forms).map((form, fi) => {
    const fields = [];
    const inputs = form.querySelectorAll('input, select, textarea');
    for (const inp of inputs) {
      const tag = inp.tagName.toLowerCase();
      let fieldType = 'text';
      let options = null;
      if (tag === 'select') {
        fieldType = 'select';
        options = Array.from(inp.options).map(o => o.value).filter(v => v);
      } else if (tag === 'textarea') {
        fieldType = 'textarea';
      } else if (tag === 'input') {
        fieldType = inp.type || 'text';
      }
      if (['hidden', 'submit', 'button', 'reset', 'image'].includes(fieldType)) continue;

      let selector = '';
      if (inp.id) selector = '#' + CSS.escape(inp.id);
      else if (inp.name) selector = tag + '[name="' + inp.name + '"]';
      else selector = 'form:nth-of-type(' + (fi + 1) + ') ' + tag + ':nth-of-type(' +
        (Array.from(form.querySelectorAll(tag)).indexOf(inp) + 1) + ')';

      fields.push({
        name: inp.name || inp.id || '',
        field_type: fieldType,
        required: inp.required || inp.getAttribute('aria-required') === 'true',
        validation_pattern: inp.pattern || null,
        options: options,
        selector: selector,
      });
    }

    let submitSelector = '';
    const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
    if (submitBtn) {
      if (submitBtn.id) submitSelector = '#' + CSS.escape(submitBtn.id);
      else submitSelector = 'form:nth-of-type(' + (fi + 1) + ') button[type="submit"], form:nth-of-type(' + (fi + 1) + ') input[type="submit"]';
    } else {
      const anyBtn = form.querySelector('button');
      if (anyBtn) {
        if (anyBtn.id) submitSelector = '#' + CSS.escape(anyBtn.id);
        else submitSelector = 'form:nth-of-type(' + (fi + 1) + ') button';
      }
    }

    return {
      action: form.action || '',
      method: (form.method || 'GET').toUpperCase(),
      fields: fields,
      submit_selector: submitSelector,
    };
  });
}`;

const CLASSIFY_PAGE_SCRIPT = `() => {
  const forms = document.querySelectorAll('form');
  const inputs = document.querySelectorAll('input, textarea, select');
  const dashWidgets = document.querySelectorAll('[class*="dashboard"], [class*="widget"], [class*="chart"], [class*="metric"]');
  const errorInd = document.querySelectorAll('[class*="error"], [class*="404"], [class*="not-found"]');
  const title = document.title.toLowerCase();
  const h1 = (document.querySelector('h1')?.textContent || '').toLowerCase();

  if (errorInd.length > 0 || title.includes('404') || title.includes('error') ||
      h1.includes('not found') || h1.includes('page not found')) return 'error';
  if (forms.length > 0 && inputs.length >= 3) return 'form';
  if (dashWidgets.length > 0) return 'dashboard';
  if (document.querySelectorAll('table, [role="grid"]').length > 0 &&
      document.querySelectorAll('a').length > 10) return 'listing';
  if (document.querySelector('article, [class*="detail"], [class*="product"], [itemtype*="schema.org"]')) return 'detail';
  return 'static';
}`;

/** Extract interactive elements from the current page (port of element_extractor.py). */
export async function extractElements(page: Page, pageId: string): Promise<ElementModel[]> {
  let raw: RawElement[];
  try {
    raw = await evalDom<RawElement[]>(page, EXTRACT_ELEMENTS_SCRIPT);
  } catch {
    return [];
  }
  return raw.map((el) => ({
    element_id: elementId(pageId, el.selector, el.tag),
    tag: el.tag,
    selector: el.selector,
    role: el.role,
    text_content: el.text_content,
    is_interactive: el.is_interactive,
    element_type: el.element_type,
    attributes: el.attributes,
  }));
}

/** Analyze all forms on the current page (port of form_analyzer.py). */
export async function analyzeForms(page: Page): Promise<FormModel[]> {
  let raw: RawForm[];
  try {
    raw = await evalDom<RawForm[]>(page, ANALYZE_FORMS_SCRIPT);
  } catch {
    return [];
  }
  return raw.map((form, i) => ({
    form_id: md5Hex(`form:${String(i)}:${form.action}`).slice(0, 10),
    action: form.action,
    method: form.method,
    fields: form.fields.map((f) => ({
      name: f.name,
      field_type: f.field_type,
      required: f.required,
      validation_pattern: f.validation_pattern,
      options: f.options,
      selector: f.selector,
    })),
    submit_selector: form.submit_selector,
  }));
}

/** Classify the page type from content heuristics (port of `_classify_page`). */
export async function classifyPage(page: Page): Promise<string> {
  try {
    return await evalDom<string>(page, CLASSIFY_PAGE_SCRIPT);
  } catch {
    return "static";
  }
}

export interface ProcessPageResult {
  page: PageModel;
}

/**
 * Build a PageModel for a loaded page: title, type, elements, forms, network
 * requests, and screenshot + DOM snapshot written under
 * `.qa/site-model/pages/<page_id>/`. Snapshot paths are stored workspace-relative.
 */
export async function processPage(
  page: Page,
  url: string,
  pageId: string,
  networkRequests: NetworkRequest[],
  ws: Workspace,
  logger: Logger,
): Promise<PageModel> {
  let title = "";
  try {
    title = (await page.title()) || "";
  } catch {
    // Non-fatal: keep an empty title.
  }

  const pageType = await classifyPage(page);
  const elements = await extractElements(page, pageId);
  const forms = await analyzeForms(page);
  logger.debug(
    `page ${pageId}: type=${pageType}, ${String(elements.length)} elements, ${String(forms.length)} forms`,
  );

  const pageDir = ws.ensureDir("site-model", "pages", pageId);
  const toRel = (abs: string): string =>
    abs.slice(ws.root.length + 1).replaceAll("\\", "/");

  let screenshotPath = "";
  try {
    const abs = `${pageDir}/screenshot.png`;
    await page.screenshot({ path: abs, fullPage: true });
    screenshotPath = toRel(abs);
  } catch (error) {
    logger.debug(`screenshot failed for ${url}: ${String(error)}`);
  }

  let domPath = "";
  try {
    const abs = `${pageDir}/dom.html`;
    writeFileSync(abs, await page.content(), "utf8");
    domPath = toRel(abs);
  } catch (error) {
    logger.debug(`DOM snapshot failed for ${url}: ${String(error)}`);
  }

  return {
    page_id: pageId,
    url,
    page_type: pageType,
    title,
    elements,
    forms,
    network_requests: networkRequests.slice(),
    screenshot_path: screenshotPath,
    dom_snapshot_path: domPath,
    auth_required: null,
  };
}
