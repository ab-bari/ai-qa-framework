/**
 * SiteModel artifact schemas — field-for-field port of the Python
 * `src/models/site_model.py` (plan §4).
 */

import { z } from "zod";

import { artifactEnvelope } from "./versions.js";

export const ElementModelSchema = z.object({
  element_id: z.string(),
  tag: z.string(),
  selector: z.string(),
  role: z.string().default(""),
  text_content: z.string().default(""),
  is_interactive: z.boolean().default(false),
  /** button, link, input, dropdown, etc. */
  element_type: z.string().default(""),
  attributes: z.record(z.string(), z.string()).default({}),
});
export type ElementModel = z.infer<typeof ElementModelSchema>;

export const FormFieldSchema = z.object({
  name: z.string(),
  /** text, email, password, select, checkbox, etc. */
  field_type: z.string(),
  required: z.boolean().default(false),
  validation_pattern: z.string().nullable().default(null),
  options: z.array(z.string()).nullable().default(null),
  selector: z.string().default(""),
});
export type FormField = z.infer<typeof FormFieldSchema>;

export const FormModelSchema = z.object({
  form_id: z.string(),
  action: z.string().default(""),
  method: z.string().default("GET"),
  fields: z.array(FormFieldSchema).default([]),
  submit_selector: z.string().default(""),
});
export type FormModel = z.infer<typeof FormModelSchema>;

export const NetworkRequestSchema = z.object({
  url: z.string(),
  method: z.string().default("GET"),
  resource_type: z.string().default(""),
  status: z.number().int().nullable().default(null),
  content_type: z.string().nullable().default(null),
});
export type NetworkRequest = z.infer<typeof NetworkRequestSchema>;

export const APIEndpointSchema = z.object({
  url: z.string(),
  method: z.string(),
  request_content_type: z.string().nullable().default(null),
  response_content_type: z.string().nullable().default(null),
  status_codes_seen: z.array(z.number().int()).default([]),
});
export type APIEndpoint = z.infer<typeof APIEndpointSchema>;

export const AuthFlowSchema = z.object({
  login_url: z.string(),
  /** form, oauth, etc. (v1 handles form auth only — plan §10). */
  login_method: z.string().default("form"),
  requires_credentials: z.boolean().default(true),
  /** "explicit", "auto_detect", or "llm_fallback". */
  detection_method: z.string().default(""),
  detected_selectors: z.record(z.string(), z.string()).default({}),
});
export type AuthFlow = z.infer<typeof AuthFlowSchema>;

export const PageModelSchema = z.object({
  page_id: z.string(),
  url: z.string(),
  /** listing, detail, form, dashboard, static, error. */
  page_type: z.string().default("static"),
  title: z.string().default(""),
  elements: z.array(ElementModelSchema).default([]),
  forms: z.array(FormModelSchema).default([]),
  network_requests: z.array(NetworkRequestSchema).default([]),
  screenshot_path: z.string().default(""),
  dom_snapshot_path: z.string().default(""),
  /** null = unknown, true = needs auth, false = public. */
  auth_required: z.boolean().nullable().default(null),
});
export type PageModel = z.infer<typeof PageModelSchema>;

export const SiteModelSchema = z.object({
  ...artifactEnvelope,
  base_url: z.string(),
  pages: z.array(PageModelSchema).default([]),
  navigation_graph: z.record(z.string(), z.array(z.string())).default({}),
  api_endpoints: z.array(APIEndpointSchema).default([]),
  auth_flow: AuthFlowSchema.nullable().default(null),
  crawl_metadata: z.record(z.string(), z.unknown()).default({}),
});
export type SiteModel = z.infer<typeof SiteModelSchema>;
