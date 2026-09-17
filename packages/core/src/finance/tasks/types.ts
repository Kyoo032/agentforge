/**
 * The seam one Finance task hangs off.
 *
 * Each task owns its own flow — its own confirmed input, its own code math, its own report — so the
 * only thing they share is this contract. A task module is pure: it never reaches the gateway, never
 * touches a file, and never formats a sentence. The host's runner drives it, the renderers read the
 * report it builds, and the number guard is fed by the numbers it declares.
 *
 * The invariant the whole of Finance rests on lives here: `compute` is the only place a number is
 * produced, `promptFacts` is the only thing the model is allowed to see, and `allowedNumbers` is the
 * only thing the guard will accept back. A task that narrates a figure it never declared has that
 * figure stripped, by construction.
 */
import type { z } from "zod";
import type { FinanceReport, ReportLocale } from "../report";
import type { GuardFlags } from "../report-brief";
import type { FinanceTask } from "../task-ids";
import type { LocalizedText } from "../tasks";

/** The narrative the model wrote, after the guard has been over every body. */
export type FinanceTaskProse = {
  readonly title: string;
  readonly sections: readonly { readonly id: string; readonly heading: string; readonly body: string }[];
  readonly assumptions: readonly string[];
};

/** What the report needs beyond the numbers: who is reading, and what the guard removed. */
export type FinanceTaskReportOptions = {
  readonly locale?: ReportLocale;
  readonly subtitle?: string;
  readonly guard?: GuardFlags;
};

/** One section the task always ends in, named in both languages. */
export type FinanceTaskSection = {
  readonly id: string;
  readonly title: LocalizedText;
};

export type FinanceTaskModule<Input, Computed> = {
  readonly id: FinanceTask;
  /**
   * The task's confirmed input, validated at the host boundary before anything is computed. The
   * schema's own input side stays `unknown`: what arrives is a parsed request body, not `Input`.
   */
  readonly inputSchema: z.ZodType<Input, z.ZodTypeDef, unknown>;
  /** Plain arithmetic over the confirmed input. No I/O, no model, no formatting. */
  compute(input: Input): Computed;
  /** The format-neutral report the workbook, the deck, the document and the screen all read. */
  buildReport(computed: Computed, prose: FinanceTaskProse, options?: FinanceTaskReportOptions): FinanceReport;
  /** The ONLY numbers the model is shown. Anything absent here cannot survive the guard. */
  promptFacts(computed: Computed, locale: ReportLocale): string;
  /** Every figure the narrative may quote: the confirmed inputs and the computed values. */
  allowedNumbers(input: Input, computed: Computed): readonly number[];
  /** The sections the narration is asked for, in order. Empty means the model picks its own. */
  readonly sections: readonly FinanceTaskSection[];
};

/**
 * The registry holds tasks whose input and computed shapes differ, so it is typed at the widest
 * point. The runner re-narrows through `inputSchema.parse`, which is the only door into a module.
 */
export type AnyFinanceTaskModule = FinanceTaskModule<unknown, unknown>;
