/**
 * Ratio health check — free text (or an uploaded statement) into rows the owner confirms.
 *
 * Deterministic first, model second, and the model never sees a number. The importer has already
 * kept the period columns, the section headings and the `[subtotal]` tags, so the rows, their
 * periods, their signs and their buckets are all read in code. Only a *label* the dictionary has
 * never met is handed to the model, on its own, with no amount beside it — and the answer comes
 * back at half the confidence of a rule, tagged `model`, so the studio can show the owner exactly
 * which rows were guessed at before a single ratio is computed.
 *
 * With nothing left over — which is the normal case for a real balance sheet — this endpoint makes
 * no gateway call at all. A workspace with no live model can still read a statement.
 *
 * Privacy: the pasted text is redacted before it is read, and the rows are redacted again on the way
 * out, so what the studio shows is exactly what may later reach the model.
 */
import { ApiError, modeMessage, type TenantContext } from "@agentforge/core";
import {
  RATIO_BUCKETS,
  classifyRatioRows,
  isRatioBucket,
  readRatioRows,
  unplacedRatioRows,
  type ClassifiedRatioRow,
  type LineItem,
  type LineItemCategory,
  type RatioBucket,
  type RatioBucketOverride,
  type RatioStatedRow,
} from "@agentforge/core/finance";
import { guardFinanceInput, mergeFinancePii, type FinancePiiSummary } from "../finance-privacy";
import { collectJobAssistantText } from "../job-regen";
import { extractJsonObject } from "../presentation-outline";
import { localeForRun } from "../run-context";
import { requireLive, resolveModel } from "./live";
import type { FinanceTaskParser } from "./types";

/** Most labels handed to the model in one call. Beyond this the statement is not a statement. */
export const RATIO_MODEL_LABEL_MAX = 40;
/** What a model's answer is worth next to a dictionary rule. Shown to the owner, never hidden. */
export const RATIO_MODEL_CONFIDENCE = 0.5;

const BUCKET_SYSTEM = `You place one financial statement line label into a bucket. You are given labels only - never amounts - and you return no numbers at all.
Return ONLY valid JSON (no markdown fences) with this exact shape:
{ "assignments": [{ "label": string, "bucket": string }] }
Rules:
- One entry per label you were given, reusing that label verbatim.
- bucket is exactly one of: ${RATIO_BUCKETS.join(", ")}.
- Labels may be Indonesian or English. "excluded" is the right answer for a total, a subtotal, a heading, or anything that is not a statement line.
- Never invent a label, never return an amount, and never explain.`;

/** The brief's nine categories, as close as they get to these buckets. The studio's row table reads them. */
const CATEGORY_OF: Readonly<Record<RatioBucket, LineItemCategory>> = Object.freeze({
  cash: "asset",
  receivables: "asset",
  inventory: "asset",
  "other-current-asset": "asset",
  "fixed-asset": "other",
  "contra-asset": "other",
  "other-noncurrent-asset": "other",
  "current-liability": "liability",
  "short-term-debt": "liability",
  "current-portion-ltd": "liability",
  "long-term-debt": "debt",
  "other-noncurrent-liability": "debt",
  equity: "equity",
  revenue: "revenue",
  cogs: "cogs",
  opex: "opex",
  depreciation: "other",
  interest: "other",
  tax: "other",
  "principal-repayment": "other",
  "other-income": "other",
  excluded: "other",
});

export type RatioClassifiedRow = {
  readonly label: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: string;
  readonly bucket: RatioBucket;
  readonly confidence: number;
  readonly source: string;
  readonly reason: string;
  readonly section: string;
};

export type ParsedRatios = {
  /** The confirmed-row shape the studio and the generate route already speak. */
  readonly items: LineItem[];
  /** The same rows with their bucket, confidence and evidence — what the studio asks the owner about. */
  readonly buckets: readonly RatioClassifiedRow[];
  readonly periods: readonly string[];
  /** Totals the importer tagged. Counted, never added. */
  readonly subtotalsIgnored: number;
  /**
   * Those same totals, forwarded verbatim. They never join a sum: the maths holds its own figures
   * against them and rebuilds a bucket the sheet printed a total for but no line of, which is how a
   * cost of sales the privacy guard could not read stops silently becoming a gross margin of 100 %.
   */
  readonly stated: readonly RatioStatedRow[];
  /** What the model was asked, and what came back. Absent when nothing was left over. */
  readonly modelAssist: { readonly asked: number; readonly placed: number; readonly error: string | null } | null;
  readonly needsConfirmation: true;
  readonly pii: FinancePiiSummary;
};

function readFiguresText(body: unknown): string {
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || !figures.trim()) {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  return figures.trim();
}

function assignmentsFrom(raw: string): readonly RatioBucketOverride[] {
  let parsed: { assignments?: unknown };
  try {
    parsed = JSON.parse(extractJsonObject(raw)) as { assignments?: unknown };
  } catch {
    throw new ApiError("invalid_finance", "Model returned invalid JSON for the bucket assignments", 502);
  }
  const list = Array.isArray(parsed.assignments) ? parsed.assignments : [];
  return list.flatMap((entry) => {
    const record = (entry ?? {}) as { label?: unknown; bucket?: unknown };
    const label = typeof record.label === "string" ? record.label.trim() : "";
    return label !== "" && isRatioBucket(record.bucket)
      ? [
          {
            label,
            period: "",
            bucket: record.bucket,
            confidence: RATIO_MODEL_CONFIDENCE,
            source: "model" as const,
          },
        ]
      : [];
  });
}

/**
 * The leftovers, and only the leftovers, sent to the model as bare labels.
 *
 * A failure here is not a failed parse: the rows stay unplaced, the studio says so, and the owner
 * picks a bucket from the dropdown. That is a better answer than a 503 on a statement that was
 * otherwise read perfectly well.
 */
async function askModelForBuckets(
  tenant: TenantContext,
  body: unknown,
  labels: readonly string[],
): Promise<{ overrides: readonly RatioBucketOverride[]; error: string | null }> {
  try {
    const settings = requireLive(tenant);
    const raw = await collectJobAssistantText({
      tenant,
      model: resolveModel(body, settings),
      systemPrompt: BUCKET_SYSTEM,
      runPrefix: "finance-ratios-buckets",
      agentId: "finance",
      jobMode: "finance",
      versionId: "finance-ratios-buckets",
      prompt: `Labels:\n${labels.map((label) => `- ${label}`).join("\n")}`,
    });
    return { overrides: assignmentsFrom(raw), error: null };
  } catch (error) {
    return { overrides: [], error: error instanceof ApiError ? error.code : "bucket_assist_failed" };
  }
}

function toLineItem(row: ClassifiedRatioRow, currency: string): LineItem {
  return {
    label: row.label,
    period: row.period ?? "",
    amount: row.amount,
    currency: row.currency ?? currency,
    category: CATEGORY_OF[row.bucket] ?? "other",
  };
}

function classifiedRow(row: ClassifiedRatioRow, item: LineItem): RatioClassifiedRow {
  return {
    label: item.label,
    period: item.period,
    amount: item.amount,
    currency: item.currency,
    bucket: row.bucket,
    confidence: row.confidence,
    source: row.source,
    reason: row.reason,
    section: row.section ?? "",
  };
}

/** Figures text → classified statement rows the owner confirms. Nothing is computed here. */
export async function parseRatiosFigures(tenant: TenantContext, body: unknown): Promise<ParsedRatios> {
  const guardedText = guardFinanceInput({ figuresText: readFiguresText(body) });
  const read = readRatioRows(guardedText.figuresText);
  if (read.rows.length === 0) {
    throw new ApiError("invalid_finance", modeMessage("noFiguresParsed", localeForRun()), 422);
  }
  const first = classifyRatioRows(read.rows);
  const leftovers = [...new Set(unplacedRatioRows(first).map((row) => row.label))].slice(0, RATIO_MODEL_LABEL_MAX);
  const assist = leftovers.length === 0 ? null : await askModelForBuckets(tenant, body, leftovers);
  const rows = assist === null ? first : classifyRatioRows(read.rows, assist.overrides);
  const guardedRows = guardFinanceInput({ lineItems: rows.map((row) => toLineItem(row, read.currency)) });
  return {
    items: guardedRows.lineItems,
    buckets: rows.map((row, index) =>
      classifiedRow(row, guardedRows.lineItems[index] ?? toLineItem(row, read.currency)),
    ),
    periods: read.periods,
    subtotalsIgnored: read.subtotals.length,
    // Read off the already-guarded text, so these labels carry the same redaction the rows do.
    stated: read.subtotals.map((row) => ({ label: row.label, period: row.period ?? "", amount: row.amount })),
    modelAssist:
      assist === null ? null : { asked: leftovers.length, placed: assist.overrides.length, error: assist.error },
    needsConfirmation: true,
    pii: mergeFinancePii(guardedText.pii, guardedRows.pii),
  };
}

export const parseRatiosInput: FinanceTaskParser = async (tenant, body) => parseRatiosFigures(tenant, body);
