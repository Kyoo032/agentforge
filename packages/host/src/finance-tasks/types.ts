/**
 * What the generic Finance task runner is handed, and what it answers with.
 *
 * The brief answers with a `FinanceBrief`; every other task answers with a `FinanceReport`, because
 * the report is the format-neutral shape the workbook, the deck, the document and the screen all
 * read. The studio branches on which one came back — `report` when the host built one, the brief's
 * own `financeReportFromBrief` otherwise.
 */
import type { JobModelFallbackNotice, TenantContext } from "@agentforge/core";
import type { FinanceReport, FinanceTask } from "@agentforge/core/finance";
import type { JobEmitter } from "@agentforge/core/jobs";
import type { GuardReport } from "../finance-brief-build";
import type { FinancePiiSummary } from "../finance-privacy";

export type FinanceTaskRunContext = {
  readonly tenant: TenantContext;
  readonly body: unknown;
  readonly emit: JobEmitter;
  readonly abortSignal?: AbortSignal;
};

export type FinanceTaskRunResult = {
  readonly task: FinanceTask;
  readonly report: FinanceReport;
  readonly artifactId: string | null;
  readonly markdown: string;
  readonly guard: GuardReport;
  /** What the privacy guard hid before anything reached the model, as the brief routes report it. */
  readonly pii: FinancePiiSummary;
  /** The model that actually answered — the stand-in when the requested one could not be reached. */
  readonly model?: string;
  /** Set only when a stand-in answered, so the desk can say so. */
  readonly notice?: JobModelFallbackNotice;
  /**
   * Anything the desk should know beyond the report: figures the guard took out, sentences removed.
   * Present only when there is something to say, so an empty list never reaches the studio.
   */
  readonly warnings?: readonly string[];
};

/**
 * Free text (or an upload's rows) turned into the confirmed input one task's schema accepts.
 *
 * One file per task — `parse-<task>.ts` — so a worker adds a file rather than editing a switch. A
 * `null` export means "reuse the brief's line-item parse", which is what every task starts out
 * doing; the answer must still be something the user confirms before anything is computed.
 */
export type FinanceTaskParser = (tenant: TenantContext, body: unknown) => Promise<unknown>;
