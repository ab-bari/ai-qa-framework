/**
 * Tier-2 self-healing: AI fallback for a failed step (plan §6.3).
 *
 * Invoked only after tier-1 deterministic resolution has exhausted its
 * alternatives. Sends the failure screenshot, a trimmed DOM excerpt and recent
 * console errors, and gets back a Zod-validated decision. Every call is
 * budgeted (`ai_max_fallback_calls_per_test`, default 3) and every decision is
 * recorded as a FallbackRecord on the TestResult — no silent healing.
 */

import { z } from "zod";

import type { Logger } from "../core/logger.js";
import type { LLMProvider } from "../llm/types.js";
import type { FallbackRecord } from "../schemas/run-result.js";
import { ActionSchema, type Action } from "../schemas/test-plan.js";

export const FallbackResponseSchema = z.object({
  decision: z.enum(["retry", "adapt", "skip", "abort"]),
  new_selector: z.string().nullable().default(null),
  new_action: ActionSchema.nullable().default(null),
  reasoning: z.string().default(""),
});
export type FallbackResponse = z.infer<typeof FallbackResponseSchema>;

export const FALLBACK_SYSTEM_PROMPT = `You are an expert QA engineer assisting an automated browser test. A test step failed and deterministic selector healing has already been tried and exhausted.

Decide what the test should do next.

Fields:
- decision: one of "retry", "adapt", "skip", "abort".
- new_selector: a corrected selector string for "retry", otherwise null.
- new_action: for "adapt", a full action object {action_type, selector, value, description}; otherwise null.
  action_type must be one of: navigate, click, fill, select, hover, scroll, wait, screenshot, keyboard.
- reasoning: one sentence explaining the decision.

Decision guidelines:
- retry: the element exists but the selector is wrong. Give the corrected selector.
- adapt: the page needs a different action first (e.g. dismiss a modal, accept cookies). Give that action.
- skip: this step cannot complete but the rest of the test is still meaningful.
- abort: the page is in an unrecoverable state and continuing would produce noise.

Prefer skip over abort. Base your selector on what is actually present in the DOM excerpt and screenshot — never guess an element that is not there.`;

export interface FallbackRequestInput {
  testName: string;
  stepIndex: number;
  stepDescription: string;
  originalSelector: string;
  actionType: string;
  errorMessage: string;
  currentUrl: string;
  domExcerpt: string;
  consoleErrors: readonly string[];
  /** Absolute path to the failure screenshot, when one was captured. */
  screenshotPath?: string | undefined;
}

export function buildFallbackPrompt(input: FallbackRequestInput): string {
  const errors = input.consoleErrors.length === 0 ? "None" : input.consoleErrors.slice(-10).join("\n");
  const screenshotLine =
    input.screenshotPath === undefined
      ? ""
      : `\nRead and examine the failure screenshot at ${input.screenshotPath}.\n`;
  return (
    `## Test\n\n${input.testName}\n\n` +
    `## Failed step ${String(input.stepIndex)}\n\n` +
    `action: ${input.actionType}\n` +
    `selector: ${input.originalSelector}\n` +
    `description: ${input.stepDescription}\n\n` +
    `## Error\n\n${input.errorMessage}\n\n` +
    `## Current URL\n\n${input.currentUrl}\n\n` +
    `## DOM excerpt\n\n${input.domExcerpt.slice(0, 3000)}\n\n` +
    `## Console errors\n\n${errors}\n` +
    screenshotLine
  );
}

/** Per-test budgeted AI fallback. One instance per test case. */
export class LlmFallbackHandler {
  private callCount = 0;

  constructor(
    private readonly llm: LLMProvider,
    private readonly maxCalls: number,
    private readonly logger: Logger,
  ) {}

  get budgetRemaining(): number {
    return Math.max(0, this.maxCalls - this.callCount);
  }

  /** Ask the model what to do. Never throws — failures become `skip`. */
  async request(input: FallbackRequestInput): Promise<FallbackResponse> {
    if (this.budgetRemaining === 0) {
      this.logger.warn(`AI fallback budget exhausted (${String(this.maxCalls)} calls).`);
      return {
        decision: "skip",
        new_selector: null,
        new_action: null,
        reasoning: "AI fallback budget exhausted",
      };
    }
    this.callCount++;
    this.logger.info(
      `AI fallback call ${String(this.callCount)}/${String(this.maxCalls)} for step ${String(input.stepIndex)}`,
    );
    try {
      const response = await this.llm.completeJson(
        {
          purpose: "selector-fallback",
          system: FALLBACK_SYSTEM_PROMPT,
          prompt: buildFallbackPrompt(input),
          ...(input.screenshotPath === undefined ? {} : { imagePaths: [input.screenshotPath] }),
        },
        FallbackResponseSchema,
      );
      this.logger.info(`AI fallback decision: ${response.decision} — ${response.reasoning}`);
      return response;
    } catch (error) {
      this.logger.error(`AI fallback call failed: ${String(error)}`);
      return {
        decision: "skip",
        new_selector: null,
        new_action: null,
        reasoning: `AI fallback call failed: ${String(error)}`,
      };
    }
  }

  /** Convert a decision into the artifact record kept on the TestResult. */
  static toRecord(
    stepIndex: number,
    originalSelector: string,
    response: FallbackResponse,
  ): FallbackRecord {
    return {
      step_index: stepIndex,
      original_selector: originalSelector,
      decision: response.decision,
      new_selector: response.new_selector,
      reasoning: response.reasoning,
    };
  }
}

/** Apply an AI-suggested selector to an action, returning a copy. */
export function withSelector(action: Action, selector: string): Action {
  return { ...action, selector };
}
