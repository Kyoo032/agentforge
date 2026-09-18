/**
 * Reading the pasted figures into two sides and a proposed pairing.
 *
 * The studio's shared parse keeps only the rows, which is all the brief ever needed. This task needs
 * the proposal too — which budget line the host thinks is which actual line, how sure it is and why —
 * because that is the thing the owner confirms before a single variance is taken. So the budget panel
 * asks the same endpoint for the same task and keeps the whole answer.
 */
import type { LineItem } from "@agentforge/core/finance";
import { apiFetch } from "./api-client";
import type {
  BudgetCandidate,
  BudgetEmbedStatus,
  BudgetProposal,
  BudgetProposalState,
  BudgetSideLabel,
} from "./finance-budget";

export type BudgetParseAnswer = { readonly items: LineItem[]; readonly proposal: BudgetProposalState };

function sideLabels(value: unknown): BudgetSideLabel[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const line = entry as { label?: unknown; kind?: unknown; category?: unknown };
        return typeof line.label === "string"
          ? [{ label: line.label, kind: String(line.kind ?? ""), category: String(line.category ?? "") }]
          : [];
      })
    : [];
}

function candidates(value: unknown): BudgetCandidate[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const row = entry as { label?: unknown; score?: unknown; stage?: unknown };
        return typeof row.label === "string"
          ? [
              {
                label: row.label,
                score: typeof row.score === "number" ? row.score : 0,
                stage: typeof row.stage === "string" ? row.stage : "unmatched",
              },
            ]
          : [];
      })
    : [];
}

function proposals(value: unknown): BudgetProposal[] {
  return Array.isArray(value)
    ? value.map((entry) => {
        const pair = entry as {
          budgetLabel?: unknown;
          actualLabel?: unknown;
          score?: unknown;
          stage?: unknown;
          candidates?: unknown;
        };
        const offered = candidates(pair.candidates);
        return {
          budgetLabel: typeof pair.budgetLabel === "string" ? pair.budgetLabel : null,
          actualLabel: typeof pair.actualLabel === "string" ? pair.actualLabel : null,
          score: typeof pair.score === "number" ? pair.score : 0,
          stage: typeof pair.stage === "string" ? pair.stage : "unmatched",
          ...(offered.length > 0 ? { candidates: offered } : {}),
        };
      })
    : [];
}

const EMBED_STATUSES: readonly BudgetEmbedStatus[] = ["used", "unavailable", "not-needed"];

/** An older host answers without this field; "not-needed" is the honest reading of silence. */
function embedStatus(value: unknown): BudgetEmbedStatus {
  const status = (value as { embedding?: unknown } | null)?.embedding;
  return EMBED_STATUSES.find((entry) => entry === status) ?? "not-needed";
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function excluded(value: unknown): { label: string; reason: string }[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const row = entry as { label?: unknown; reason?: unknown };
        return typeof row.label === "string" ? [{ label: row.label, reason: String(row.reason ?? "") }] : [];
      })
    : [];
}

function errorMessage(payload: unknown, fallback: string): string {
  const error = (payload as { error?: { message?: unknown } } | null)?.error;
  return error && typeof error.message === "string" && error.message.trim() ? error.message : fallback;
}

/** Figures text in, the rows and the proposed pairing out. Nothing is computed in the browser. */
export async function parseBudgetFigures(
  figures: string,
  options: { readonly model?: string; readonly params?: unknown; readonly fallbackError: string },
): Promise<BudgetParseAnswer> {
  const res = await apiFetch("/api/v1/finance/parse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      figures,
      task: "budget",
      model: options.model || undefined,
      params: options.params ?? {},
    }),
  });
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok || !data) {
    throw new Error(errorMessage(data, options.fallbackError));
  }
  return {
    items: Array.isArray(data.items) ? (data.items as LineItem[]) : [],
    proposal: {
      budget: sideLabels(data.budget),
      actual: sideLabels(data.actual),
      pairs: proposals(data.pairs),
      periods: strings(data.periods),
      excluded: excluded(data.excluded),
      embedding: embedStatus(data.matching),
    },
  };
}
