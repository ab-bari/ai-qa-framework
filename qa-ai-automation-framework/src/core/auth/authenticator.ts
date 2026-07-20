/**
 * Smart authentication (plan §6.1, §3 core/auth). Three-tier login-form
 * detection ported from the Python `src/auth/smart_auth.py`:
 *   Tier 1 — explicit selectors from config;
 *   Tier 2 — heuristic auto-detection (form scoring + orphan-field scan);
 *   Tier 3 — LLM vision fallback (screenshot + DOM → Claude), the crawler's only
 *            AI touchpoint.
 * Kept self-contained (its own browser-side login-form scan) so `core/` never
 * imports a pipeline component.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";

import type { BrowserContext, Page } from "playwright";
import { z } from "zod";

import { evalDom } from "../browser/eval-dom.js";
import { timestampId } from "../ids.js";
import type { Logger } from "../logger.js";
import type { LLMProvider } from "../../llm/types.js";
import type { AuthConfig } from "../../schemas/config.js";
import type { AuthFlow } from "../../schemas/site-model.js";

export interface SmartAuthResult {
  success: boolean;
  authFlow?: AuthFlow;
  error?: string;
  postLoginUrl?: string;
}

export interface SmartAuthOptions {
  llm?: LLMProvider | undefined;
  logger: Logger;
  /** Absolute directory for the Tier-3 login screenshot; defaults to the OS temp dir. */
  screenshotDir?: string | undefined;
}

interface LoginSelectors {
  username: string;
  password: string;
  submit: string;
}

const AuthDetectionSchema = z.object({
  username_selector: z.string().default(""),
  password_selector: z.string().default(""),
  submit_selector: z.string().default(""),
  confidence: z.number().default(0),
  reasoning: z.string().default(""),
});

const AUTH_DETECTION_SYSTEM_PROMPT = `You are an expert at analyzing web page login forms. You will be shown a screenshot of a login page along with its DOM structure.

Your task is to identify the CSS selectors for the login form fields.

Return exactly this JSON structure:
{
  "username_selector": "css-selector-for-username-field",
  "password_selector": "css-selector-for-password-field",
  "submit_selector": "css-selector-for-submit-button",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation of how you identified each element"
}

Guidelines:
- Prefer selectors using id attributes (#id), then name attributes (input[name="..."]), then type-based selectors.
- For the username field, look for inputs of type email, text, or tel that appear before the password field.
- For the password field, look for inputs of type password.
- For the submit button, look for buttons or inputs with type submit, or buttons with text like "Log in", "Sign in", "Submit".
- If the login form uses a non-standard structure (e.g. no <form> tag, custom web components), still identify the interactive elements.
- If you cannot identify a field, set its selector to an empty string and set confidence below 0.5.
- Only set confidence above 0.8 if you are very sure about all three selectors.`;

/** Browser-side login-form detection: form scoring + orphan-field scan (Tiers 2). */
const DETECT_LOGIN_FORM_SCRIPT = `() => {
  const ACTION_KW = ['login','signin','sign-in','auth','session','log-in'];
  const USER_KW = ['user','login','email','account','uname','identifier'];

  function analyzeForm(form) {
    const fields = [];
    for (const inp of form.querySelectorAll('input, select, textarea')) {
      const tag = inp.tagName.toLowerCase();
      let type = tag === 'select' ? 'select' : tag === 'textarea' ? 'textarea' : (inp.type || 'text');
      if (['hidden','submit','button','reset','image'].includes(type)) continue;
      let sel = inp.id ? '#' + CSS.escape(inp.id) : (inp.name ? tag + '[name="' + inp.name + '"]' : '');
      fields.push({ type: type, name: (inp.name || inp.id || '').toLowerCase(), selector: sel });
    }
    let submit = '';
    const sb = form.querySelector('button[type="submit"], input[type="submit"]');
    if (sb) submit = sb.id ? '#' + CSS.escape(sb.id) : 'button[type="submit"]';
    else { const b = form.querySelector('button'); if (b) submit = b.id ? '#' + CSS.escape(b.id) : 'button'; }
    return { fields: fields, submit: submit, action: (form.action || '').toLowerCase() };
  }

  function score(f) {
    let s = 0;
    if (f.fields.some(x => x.type === 'password')) s += 10;
    if (f.fields.some(x => x.type === 'text' || x.type === 'email')) s += 5;
    const n = f.fields.length;
    if (n >= 1 && n <= 4) s += 3;
    if (n < 6) s += 1;
    if (f.submit) s += 2;
    if (ACTION_KW.some(k => f.action.includes(k))) s += 3;
    return s;
  }

  function password(f) { const p = f.fields.find(x => x.type === 'password' && x.selector); return p ? p.selector : null; }
  function username(f) {
    const email = f.fields.find(x => x.type === 'email' && x.selector);
    if (email) return email.selector;
    for (const x of f.fields) {
      if (['text','email','tel'].includes(x.type) && x.selector && USER_KW.some(k => x.name.includes(k))) return x.selector;
    }
    const texts = f.fields.filter(x => ['text','email','tel'].includes(x.type) && x.selector);
    return texts.length > 0 ? texts[0].selector : null;
  }

  const forms = Array.from(document.querySelectorAll('form')).map(analyzeForm);
  let best = null, bestScore = 0;
  for (const f of forms) { const sc = score(f); if (sc > bestScore) { bestScore = sc; best = f; } }
  if (best && bestScore >= 12) {
    const pw = password(best), user = username(best);
    if (pw && user) return { username: user, password: pw, submit: best.submit || "button[type='submit'], button" };
  }

  const pwInputs = Array.from(document.querySelectorAll('input[type="password"]'))
    .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
  const pwInput = pwInputs.find(el => !el.closest('form'));
  if (pwInput) {
    const pwSel = pwInput.id ? '#' + CSS.escape(pwInput.id) : (pwInput.name ? 'input[name="' + pwInput.name + '"]' : 'input[type="password"]');
    const container = pwInput.closest('div, section, main, [role="dialog"], [class*="login"], [class*="auth"]') || document.body;
    const textInputs = Array.from(container.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"]'))
      .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    if (textInputs.length > 0) {
      const u = textInputs[0];
      const uSel = u.id ? '#' + CSS.escape(u.id) : (u.name ? 'input[name="' + u.name + '"]' : 'input[type="' + (u.type || 'text') + '"]');
      const buttons = Array.from(container.querySelectorAll('button, input[type="submit"], [role="button"]'))
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const sb = buttons.find(b => b.type === 'submit');
      let submitSel = sb ? (sb.id ? '#' + CSS.escape(sb.id) : 'button[type="submit"]')
        : (buttons.length > 0 ? (buttons[0].id ? '#' + CSS.escape(buttons[0].id) : 'button') : '');
      if (submitSel) return { username: uSel, password: pwSel, submit: submitSel };
    }
  }
  return null;
}`;

const PASSWORD_VISIBLE_SCRIPT = `() => {
  const pw = document.querySelector('input[type="password"]');
  if (!pw) return false;
  const r = pw.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}`;

function hasAllExplicitSelectors(auth: AuthConfig): boolean {
  return (
    auth.username_selector !== "" && auth.password_selector !== "" && auth.submit_selector !== ""
  );
}

async function autoDetect(page: Page): Promise<LoginSelectors | null> {
  try {
    return await evalDom<LoginSelectors | null>(page, DETECT_LOGIN_FORM_SCRIPT);
  } catch {
    return null;
  }
}

async function llmDetect(
  page: Page,
  auth: AuthConfig,
  llm: LLMProvider,
  screenshotDir: string,
  logger: Logger,
): Promise<LoginSelectors | null> {
  try {
    const screenshotPath = join(screenshotDir, `login-${timestampId()}.png`);
    await page.screenshot({ path: screenshotPath });
    const dom = (await page.content()).slice(0, 6000);
    const result = await llm.completeJson(
      {
        purpose: "auth-detect",
        system: AUTH_DETECTION_SYSTEM_PROMPT,
        prompt:
          `Login page URL: ${auth.login_url}\n\nDOM Structure:\n${dom}\n\n` +
          `Read and examine the screenshot at ${screenshotPath}, then identify the ` +
          `login form fields and submit button.`,
        imagePaths: [screenshotPath],
      },
      AuthDetectionSchema,
    );
    logger.info(
      `LLM auth detection: confidence=${result.confidence.toFixed(2)} — ${result.reasoning}`,
    );
    if (result.confidence < 0.5) {
      return null;
    }
    if (
      result.username_selector === "" ||
      result.password_selector === "" ||
      result.submit_selector === ""
    ) {
      return null;
    }
    return {
      username: result.username_selector,
      password: result.password_selector,
      submit: result.submit_selector,
    };
  } catch (error) {
    logger.debug(`LLM auth detection failed: ${String(error)}`);
    return null;
  }
}

/** Resolve login selectors via the three tiers. Returns selectors + detection method. */
async function resolveSelectors(
  page: Page,
  auth: AuthConfig,
  opts: SmartAuthOptions,
): Promise<{ selectors: LoginSelectors; method: string } | null> {
  // Tier 1: explicit selectors (all provided, or auto-detect disabled).
  if (!auth.auto_detect || hasAllExplicitSelectors(auth)) {
    opts.logger.info("smart-auth: using explicit selectors");
    return {
      selectors: {
        username: auth.username_selector,
        password: auth.password_selector,
        submit: auth.submit_selector,
      },
      method: "explicit",
    };
  }

  // Tier 2: heuristic auto-detect (reached only when auto_detect is enabled).
  const detected = await autoDetect(page);
  if (detected !== null) {
    opts.logger.info("smart-auth: auto-detected login form");
    return { selectors: detected, method: "auto_detect" };
  }

  // Tier 3: LLM vision fallback.
  if (auth.llm_fallback && opts.llm !== undefined) {
    const detected = await llmDetect(
      page,
      auth,
      opts.llm,
      opts.screenshotDir ?? tmpdir(),
      opts.logger,
    );
    if (detected !== null) {
      opts.logger.info("smart-auth: LLM identified login form");
      return { selectors: detected, method: "llm_fallback" };
    }
  }

  // Last resort: partial/default selectors if any explicit hint was given.
  if (auth.username_selector !== "" || auth.password_selector !== "") {
    opts.logger.warn("smart-auth: falling back to partial/default selectors");
    return {
      selectors: {
        username: auth.username_selector || "input[type='text'], input[type='email']",
        password: auth.password_selector || "input[type='password']",
        submit: auth.submit_selector || "button[type='submit'], button",
      },
      method: "explicit",
    };
  }

  return null;
}

async function verifyLoginSuccess(page: Page, auth: AuthConfig): Promise<boolean> {
  if (auth.success_indicator !== "") {
    try {
      await page.waitForSelector(auth.success_indicator, { timeout: 10_000 });
      return true;
    } catch {
      // Fall through to other checks.
    }
  }
  try {
    await page.waitForLoadState("networkidle", { timeout: 10_000 });
  } catch {
    // networkidle may never settle — continue.
  }

  const loginPath = auth.login_url.replace(/\/+$/, "");
  if (page.url().replace(/\/+$/, "") !== loginPath) {
    return true;
  }

  try {
    const passwordVisible = await evalDom<boolean>(page, PASSWORD_VISIBLE_SCRIPT);
    if (!passwordVisible) {
      return true;
    }
  } catch {
    // Ignore evaluation failures.
  }

  return auth.success_indicator === "";
}

/**
 * Authenticate `context` in place: navigate to the login page, resolve
 * selectors, fill and submit, and verify. On success the caller can capture
 * `context.storageState(...)` for reuse.
 */
export async function performSmartAuth(
  context: BrowserContext,
  auth: AuthConfig,
  opts: SmartAuthOptions,
): Promise<SmartAuthResult> {
  opts.logger.info(`smart-auth: navigating to ${auth.login_url}`);
  const page = await context.newPage();
  try {
    await page.goto(auth.login_url, { waitUntil: "networkidle", timeout: 30_000 });

    const resolved = await resolveSelectors(page, auth, opts);
    if (resolved === null) {
      return { success: false, error: "Could not identify login form fields" };
    }
    const { selectors, method } = resolved;

    opts.logger.info(`smart-auth: filling form (method=${method})`);
    await page.fill(selectors.username, auth.username);
    await page.fill(selectors.password, auth.password);
    await page.click(selectors.submit);

    const success = await verifyLoginSuccess(page, auth);
    if (!success) {
      return {
        success: false,
        error: `Login form submitted (method=${method}) but verification failed`,
      };
    }

    // Wait for any JS-triggered post-login redirect to settle.
    const loginNormalized = auth.login_url.replace(/\/+$/, "");
    try {
      await page.waitForURL((url) => url.toString().replace(/\/+$/, "") !== loginNormalized, {
        timeout: 5000,
      });
      try {
        await page.waitForLoadState("networkidle", { timeout: 5000 });
      } catch {
        // Settled enough.
      }
    } catch {
      // URL may not change (SPA / in-place auth).
    }

    const postLoginUrl = page.url();
    opts.logger.info(`smart-auth: login successful (method=${method}), landed on ${postLoginUrl}`);
    return {
      success: true,
      postLoginUrl,
      authFlow: {
        login_url: auth.login_url,
        login_method: "form",
        requires_credentials: true,
        detection_method: method,
        detected_selectors: {
          username: selectors.username,
          password: selectors.password,
          submit: selectors.submit,
        },
      },
    };
  } catch (error) {
    opts.logger.error(`smart-auth failed: ${String(error)}`);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await page.close();
  }
}
