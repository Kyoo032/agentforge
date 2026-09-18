/**
 * The appraisal's parse hook: an outlay, the yearly flows and a discount rate the owner confirms.
 *
 * Deterministic first. An appraisal sheet is a label column and year columns, which code can read
 * outright — so `appraisalGridFromText` produces the rows, and the model is never asked to
 * transcribe an amount. Only text that is NOT such a table falls through to the brief's line-item
 * read, and even then the rows come back for confirmation before anything is computed.
 *
 * Privacy: the figures text is redacted before it is read, and the rows are redacted again before
 * they are answered with. Nothing here reaches the network on the deterministic path at all.
 */
import { ApiError } from "@agentforge/core";
import {
  appraisalFlowsFromItems,
  appraisalGridFromText,
  discountRateFromText,
  netFlowsOf,
  outlayOf,
  type LineItem,
} from "@agentforge/core/finance";
import { parseFinanceFigures } from "../finance-generate";
import { guardFinanceInput, type FinancePiiSummary } from "../finance-privacy";
import type { FinanceTaskParser } from "./types";

/** One year as the confirm step shows it: the period, its net flow, and the rows behind it. */
export type AppraisalFlowRow = {
  readonly period: string;
  readonly year: number;
  readonly amount: number;
  readonly components: readonly { readonly label: string; readonly amount: number }[];
};

export type ParsedAppraisal = {
  /** The component rows, which are what the owner edits and what the task computes from. */
  readonly items: LineItem[];
  /** The same rows netted per year, for the flows table the confirm step draws. */
  readonly flows: readonly AppraisalFlowRow[];
  /** The flow at t = 0, negative for a real investment. Null when no year could be read. */
  readonly outlay: number | null;
  /** The rate the request named, for the field the owner then confirms. Null when it named none. */
  readonly discountRatePercent: number | null;
  /** The subtotal rows that were dropped, so the owner can see they were not double counted. */
  readonly droppedSubtotals: readonly string[];
  /** True always: nothing is computed until these rows come back confirmed. */
  readonly needsConfirmation: true;
  readonly pii: FinancePiiSummary;
};

function readFigures(body: unknown): string {
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || figures.trim() === "") {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  return figures.trim();
}

/** The typed prompt, when the studio sent one: a rate is often named there and not in the sheet. */
function readPromptText(body: unknown): string {
  const prompt = (body as { prompt?: unknown } | null)?.prompt;
  return typeof prompt === "string" ? prompt : "";
}

function flowsOf(items: readonly LineItem[]): AppraisalFlowRow[] {
  return appraisalFlowsFromItems(items).map((flow) => ({
    period: flow.period,
    year: flow.year,
    amount: flow.net,
    components: flow.components.map((part) => ({ label: part.label, amount: part.amount })),
  }));
}

function answer(
  items: LineItem[],
  pii: FinancePiiSummary,
  discountRatePercent: number | null,
  droppedSubtotals: readonly string[],
): ParsedAppraisal {
  const flows = flowsOf(items);
  return {
    items,
    flows,
    outlay: outlayOf(appraisalFlowsFromItems(items)),
    discountRatePercent,
    droppedSubtotals,
    needsConfirmation: true,
    pii,
  };
}

/**
 * Free text or an imported sheet to the appraisal's confirmed input.
 *
 * The grid path answers without a model at all; the fallback reuses the brief's parse, which is
 * still a read the owner confirms rather than a figure anyone computed.
 */
export const parseAppraisalInput: FinanceTaskParser = async (tenant, body) => {
  const raw = readFigures(body);
  const guarded = guardFinanceInput({ figuresText: raw });
  const rate = discountRateFromText(`${readPromptText(body)}\n${guarded.figuresText}`);
  const grid = appraisalGridFromText(guarded.figuresText);
  if (grid) {
    const rows = guardFinanceInput({ lineItems: grid.items });
    return answer(rows.lineItems, guarded.pii, rate, grid.subtotals);
  }
  const parsed = await parseFinanceFigures(tenant, body);
  const rows = guardFinanceInput({ lineItems: parsed.items });
  return answer(rows.lineItems, parsed.pii, rate, []);
};

/** The flows a set of confirmed rows implies, exported for the studio's own preview. */
export function appraisalFlowPreview(items: readonly LineItem[]): {
  readonly flows: readonly AppraisalFlowRow[];
  readonly nets: readonly number[];
} {
  const flows = appraisalFlowsFromItems(items);
  return { flows: flowsOf(items), nets: netFlowsOf(flows) };
}
