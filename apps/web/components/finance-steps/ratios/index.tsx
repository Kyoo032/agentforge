"use client";

/**
 * Ratio health check — the studio's two halves for this task.
 *
 * The inputs panel is the confirm step of the flow (statement in, every row's bucket confirmed, the
 * balance checked before anything is computed); the result panel renders the `FinanceReport` the
 * task answers with, which the brief's shared panel cannot because there is no `FinanceBrief`
 * behind it.
 */
import type { FinanceStepEntry } from "../types";
import { RatiosInputs } from "./ratios-inputs";
import { RatiosResult } from "./ratios-result";

export { RatiosInputs, RatiosResult };
export type { RatiosStepDraft } from "./ratios-inputs";

export const RATIOS_STEPS: FinanceStepEntry = { Inputs: RatiosInputs, Result: RatiosResult };
