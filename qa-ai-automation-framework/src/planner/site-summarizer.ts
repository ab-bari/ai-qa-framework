/**
 * Site summarizer (plan §6.2). Never feeds the raw SiteModel to the LLM
 * (anti-pattern, plan §10): produces a CONDENSED JSON summary — first 30 pages
 * (gap-flagged pages first, then page-type diversity), ≤20 interactive
 * elements per page, forms in full, the auth flow, and the top API endpoints.
 * Port of the Python `Planner._summarize_site_model`.
 */

import type { CoverageGapReport } from "../schemas/coverage.js";
import type { PageModel, SiteModel } from "../schemas/site-model.js";

const MAX_PAGES = 30;
const MAX_ELEMENTS_PER_PAGE = 20;
const MAX_API_ENDPOINTS = 15;
const MAX_TEXT_CHARS = 50;

/** Page ids flagged by the gap report, in priority order (untested → failures → low-cov → stale). */
function gapFlaggedIds(gap: CoverageGapReport): string[] {
  const ordered: string[] = [
    ...gap.untested_pages,
    ...gap.recent_failures.map(([pid]) => pid),
    ...gap.low_coverage_areas.map(([pid]) => pid),
    ...gap.stale_pages,
  ];
  return [...new Set(ordered)];
}

/** Round-robin the remaining pages by page_type so the summary stays diverse. */
function diversifyByType(pages: PageModel[]): PageModel[] {
  const byType = new Map<string, PageModel[]>();
  for (const page of pages) {
    const bucket = byType.get(page.page_type) ?? [];
    bucket.push(page);
    byType.set(page.page_type, bucket);
  }
  const buckets = [...byType.values()];
  const result: PageModel[] = [];
  let added = true;
  while (added) {
    added = false;
    for (const bucket of buckets) {
      const next = bucket.shift();
      if (next !== undefined) {
        result.push(next);
        added = true;
      }
    }
  }
  return result;
}

/** Select and order the pages to summarize: gap-flagged first, then diversified rest. */
function selectPages(siteModel: SiteModel, gap: CoverageGapReport): PageModel[] {
  const flagged = new Set(gapFlaggedIds(gap));
  const prioritized = siteModel.pages.filter((p) => flagged.has(p.page_id));
  const rest = diversifyByType(siteModel.pages.filter((p) => !flagged.has(p.page_id)));
  return [...prioritized, ...rest].slice(0, MAX_PAGES);
}

/**
 * Build the condensed site summary JSON string (plan §6.2). `gap` steers which
 * pages are kept when the site exceeds the page budget.
 */
export function summarizeSiteModel(siteModel: SiteModel, gap: CoverageGapReport): string {
  const summary = {
    base_url: siteModel.base_url,
    has_auth: siteModel.auth_flow !== null,
    auth_flow:
      siteModel.auth_flow === null
        ? null
        : {
            login_url: siteModel.auth_flow.login_url,
            login_method: siteModel.auth_flow.login_method,
            detected_selectors: siteModel.auth_flow.detected_selectors,
          },
    api_endpoints_count: siteModel.api_endpoints.length,
    top_api_endpoints: siteModel.api_endpoints.slice(0, MAX_API_ENDPOINTS).map((e) => ({
      url: e.url,
      method: e.method,
    })),
    pages: selectPages(siteModel, gap).map((page) => ({
      page_id: page.page_id,
      url: page.url,
      page_type: page.page_type,
      title: page.title,
      auth_required: page.auth_required,
      interactive_elements_count: page.elements.filter((e) => e.is_interactive).length,
      forms: page.forms.map((form) => ({
        form_id: form.form_id,
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
      key_elements: page.elements
        .filter((e) => e.is_interactive)
        .slice(0, MAX_ELEMENTS_PER_PAGE)
        .map((e) => ({
          selector: e.selector,
          type: e.element_type,
          role: e.role,
          text: e.text_content.slice(0, MAX_TEXT_CHARS),
        })),
    })),
  };

  return JSON.stringify(summary, null, 2);
}
