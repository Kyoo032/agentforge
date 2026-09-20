/**
 * The one stage of the budget pairing that leaves this machine, and everything that keeps it safe.
 *
 * WHAT IS SENT: line LABELS, and nothing else. Not an amount, not a period, not a scenario, not the
 * name of the file they came from — a label list carries no figure, so the worst a reader of the
 * wire could learn is that someone somewhere budgets for stationery. The labels arrive already
 * redacted by `guardFinanceInput` (the caller's contract), are de-duplicated, truncated and capped,
 * and are handed to the embedder in one call. The destination is the same pinned gateway the chat
 * model uses: `knowledge-embed` resolves it from `resolveProviderKeys`, never from a stored setting.
 *
 * WHEN IT IS SKIPPED: whenever the answer would not be about meaning. With no gateway key, with the
 * circuit breaker open, or in stub runtime, `embedTextsWithModel` answers with `stub-fnv-32` vectors
 * — a 32-dimension word hash whose cosine measures spelling, not sense. Scoring those would dress a
 * coincidence up as understanding, so a stub answer is discarded exactly like a failure, the pairing
 * stays on its local stages, and the parse response says `unavailable` so the screen can say so too.
 *
 * Nothing here decides a pair. It returns a cosine function; `proposeBudgetPairs` in core decides
 * what, if anything, that cosine is worth.
 */
import { cosineSimilarity, type TenantContext } from "@agentforge/core";
import type { BudgetSideLine, BudgetSimilarity } from "@agentforge/core/finance";
import { getKnowledgeModels } from "../knowledge";
import { STUB_EMBED_MODEL, embedTextsWithModel } from "../knowledge-embed";
import { log } from "../log";

/** Above this many labels the pairing stays local: an embedding per label stops being cheap. */
export const BUDGET_EMBED_LABEL_MAX = 200;
/** A line label is a few words. Anything longer is a sentence that wandered into the label column. */
export const BUDGET_EMBED_LABEL_CHARS = 120;

/**
 * What the parse response tells the screen about this stage.
 *
 * `not-needed` and `unavailable` are different sentences: one says the local stages already paired
 * everything, the other says the meaning stage could not run and some line may be unmatched for that
 * reason alone.
 */
export type BudgetEmbedStatus = "used" | "unavailable" | "not-needed";

export type BudgetEmbedding = {
  readonly status: BudgetEmbedStatus;
  /** Present only when `status` is "used". */
  readonly similarity?: BudgetSimilarity;
};

/** The embedder and the model lookup, injectable so a test can run this with no network and no database. */
export type BudgetEmbedDeps = {
  readonly embed?: typeof embedTextsWithModel;
  readonly models?: (tenant: TenantContext) => { readonly embeddingModel: string };
};

/** Labels only, deduplicated, each cut to a label's length. The single place the payload is built. */
export function budgetEmbedLabels(
  budget: readonly BudgetSideLine[],
  actual: readonly BudgetSideLine[],
): readonly string[] {
  const all = [...budget, ...actual].map((line) => line.label.trim().slice(0, BUDGET_EMBED_LABEL_CHARS));
  return [...new Set(all.filter((label) => label.length > 0))];
}

/**
 * True when both sides still hold a line that found no partner. Only then can a cosine change any
 * answer, and a call that cannot change the answer is a call that should not be made.
 */
export function budgetEmbedWorthwhile(pairing: {
  readonly budgetOnly: readonly string[];
  readonly actualOnly: readonly string[];
}): boolean {
  return pairing.budgetOnly.length > 0 && pairing.actualOnly.length > 0;
}

function lookupCosine(labels: readonly string[], vectors: readonly number[][]): BudgetSimilarity {
  const byLabel = new Map(labels.map((label, at) => [label, vectors[at] ?? []]));
  return (left: string, right: string): number => {
    const a = byLabel.get(left.trim().slice(0, BUDGET_EMBED_LABEL_CHARS));
    const b = byLabel.get(right.trim().slice(0, BUDGET_EMBED_LABEL_CHARS));
    return a && b && a.length > 0 && b.length > 0 ? cosineSimilarity(a, b) : Number.NaN;
  };
}

/**
 * A cosine between any two of these labels, or a reason there is none.
 *
 * Never throws: the pairing is already correct without this stage, so a failure here is a note on
 * the screen rather than a failed parse.
 */
export async function embedBudgetLabels(
  tenant: TenantContext,
  budget: readonly BudgetSideLine[],
  actual: readonly BudgetSideLine[],
  deps: BudgetEmbedDeps = {},
): Promise<BudgetEmbedding> {
  const labels = budgetEmbedLabels(budget, actual);
  if (labels.length === 0 || labels.length > BUDGET_EMBED_LABEL_MAX) {
    return { status: "unavailable" };
  }
  const embed = deps.embed ?? embedTextsWithModel;
  const models = deps.models ?? getKnowledgeModels;
  try {
    const wanted = models(tenant).embeddingModel;
    const { vectors, model } = await embed([...labels], wanted, tenant);
    if (model === STUB_EMBED_MODEL || vectors.length !== labels.length) {
      return { status: "unavailable" };
    }
    return { status: "used", similarity: lookupCosine(labels, vectors) };
  } catch (error) {
    const why = error instanceof Error ? error.message.slice(0, 80) : "error";
    log.warn("finance_budget_embeddings_unavailable", { detail: why });
    return { status: "unavailable" };
  }
}
