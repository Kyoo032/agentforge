/**
 * Where a finished task report is saved.
 *
 * The brief rides on its artifact as a `FinanceBrief` (see `finance-artifact.ts`); a task has no
 * brief, so the format-neutral report rides along instead, under its own meta key and behind the
 * same size cap. An export that only has the artifact id can then still rebuild the workbook's
 * tables and the deck's chart series instead of falling back to prose.
 */
import { ApiError } from "@agentforge/core";
import type { ArtifactMeta } from "@agentforge/core/artifacts";
import type { FinanceReport, ReportLocale } from "@agentforge/core/finance";
import { artifactStore } from "../artifacts";
import { FINANCE_META_GUARD_KEY, FINANCE_META_MAX_BYTES, type FinanceStoredGuard } from "../finance-artifact";
import type { TenantContext } from "@agentforge/core";
import { financeReportSchema } from "./report-schema";

/** Meta key the stored report sits under, beside the brief's own key. */
export const FINANCE_META_REPORT_KEY = "report";

/**
 * What a task artifact records about the run that made it.
 *
 * `task`, `model` and `locale` are the three an export cannot rebuild from the markdown: which
 * flow computed the numbers, which model wrote the sentences, and which language the reader asked
 * for. An artifact saved without them exports as prose in whatever language the process happens to
 * be running in, which is how an Indonesian report came back in English a release later.
 */
export type FinanceTaskProvenance = {
  readonly task: string;
  readonly model: string;
  readonly locale: ReportLocale;
  /** What the person typed. Optional: a rerun from a saved artifact has no new question. */
  readonly question?: string;
  /** Figures the guard could not trace, and sentences taken out after one rewrite. */
  readonly flagged?: number;
  readonly removed?: number;
};

/** The provenance bag, with the keys that are absent left out rather than written as undefined. */
export function financeTaskProvenance(provenance: FinanceTaskProvenance): Record<string, unknown> {
  return {
    task: provenance.task,
    model: provenance.model,
    locale: provenance.locale,
    ...(provenance.question ? { question: provenance.question } : {}),
    ...(provenance.flagged === undefined ? {} : { flagged: provenance.flagged }),
    ...(provenance.removed === undefined ? {} : { removed: provenance.removed }),
  };
}

/** Provenance plus the report, or provenance alone when the report is too big to carry. */
export function financeTaskArtifactMeta(
  provenance: Record<string, unknown>,
  report: FinanceReport,
  guard: FinanceStoredGuard,
): Record<string, unknown> {
  const stored = { [FINANCE_META_REPORT_KEY]: report, [FINANCE_META_GUARD_KEY]: guard };
  if (Buffer.byteLength(JSON.stringify(stored), "utf8") > FINANCE_META_MAX_BYTES) {
    console.warn(`finance: report over ${FINANCE_META_MAX_BYTES} bytes; its export will fall back to the markdown`);
    return { ...provenance };
  }
  return { ...provenance, ...stored };
}

/** The stored report, or null for an artifact that was saved without one. */
export function readStoredFinanceReport(meta: ArtifactMeta | undefined): FinanceReport | null {
  const parsed = financeReportSchema.safeParse(meta?.[FINANCE_META_REPORT_KEY]);
  return parsed.success ? parsed.data : null;
}

/** Saving is best effort: a report the reader can still export beats a failed run. */
export function persistFinanceTaskReport(
  tenant: TenantContext,
  report: FinanceReport,
  markdown: string,
  meta: Record<string, unknown>,
): string | null {
  try {
    return artifactStore().create(tenant, {
      mode: "finance",
      kind: "report",
      title: report.title,
      mime: "text/markdown",
      body: markdown,
      meta,
    }).id;
  } catch (error) {
    const code = error instanceof ApiError ? error.code : "internal_error";
    console.warn(`finance: could not save the ${report.task} report (${code})`);
    return null;
  }
}
