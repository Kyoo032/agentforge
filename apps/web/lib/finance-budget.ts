/**
 * The budget studio's own logic, kept out of the components so it can be tested without a DOM.
 *
 * Two things live here. The pairing the owner is editing — which is a one-to-one assignment, so
 * re-pairing one line has to free whatever the two lines were previously bound to, and no edit may
 * ever mutate the array it was handed. And the geometry of the variance bars, which is arithmetic
 * over numbers the report already computed: nothing on this screen produces a figure of its own.
 */
import {
  budgetInputSchema,
  computeBudget,
  type LineItem,
  type ReportChart,
  type ReportTable,
} from "@agentforge/core/finance";

/** What the budget task carries in the studio's parameter bag. Only these reach the host. */
export type BudgetUiParams = {
  readonly flagPct?: number;
  readonly flagAbs?: number;
  readonly flagMode?: "and" | "or";
  readonly budgetSheet?: string;
  readonly actualSheet?: string;
  /** Present only once the owner has edited the pairing; absent means "use the proposal". */
  readonly pairs?: readonly BudgetPair[];
};

export type BudgetPair = { readonly budgetLabel: string | null; readonly actualLabel: string | null };

/** A partner the matcher considered but did not bind, offered to the reader as a one-click choice. */
export type BudgetCandidate = { readonly label: string; readonly score: number; readonly stage: string };

/** One proposed pair, as the parse hook answers with it. */
export type BudgetProposal = BudgetPair & {
  readonly score: number;
  readonly stage: string;
  readonly candidates?: readonly BudgetCandidate[];
};

export type BudgetSideLabel = { readonly label: string; readonly kind: string; readonly category: string };

/** Whether the meaning stage ran. `unavailable` is a sentence the reader is owed, not a silent skip. */
export type BudgetEmbedStatus = "used" | "unavailable" | "not-needed";

/** Everything the panel holds between reading the figures and generating the report. */
export type BudgetProposalState = {
  readonly budget: readonly BudgetSideLabel[];
  readonly actual: readonly BudgetSideLabel[];
  readonly pairs: readonly BudgetProposal[];
  readonly periods: readonly string[];
  readonly excluded: readonly { readonly label: string; readonly reason: string }[];
  readonly embedding: BudgetEmbedStatus;
};

export const EMPTY_BUDGET_PROPOSAL: BudgetProposalState = Object.freeze({
  budget: Object.freeze([]),
  actual: Object.freeze([]),
  pairs: Object.freeze([]),
  periods: Object.freeze([]),
  excluded: Object.freeze([]),
  embedding: "not-needed",
});

/** Percent limit a fresh sheet starts on, until the owner says otherwise. */
export const DEFAULT_BUDGET_FLAG_PCT = 10;
export const DEFAULT_BUDGET_FLAG_ABS = 0;

/** Confidence bands the pairing table shows as chips. A low score is a question, not an answer. */
export const BUDGET_CONFIDENCE_HIGH = 0.85;
export const BUDGET_CONFIDENCE_MEDIUM = 0.6;

export type BudgetConfidence = "high" | "medium" | "low" | "none";

/**
 * Which of three sentences the chip says: the two labels were the same word, a dictionary read them
 * as the same thing, or an embedding read them as the same meaning.
 *
 * The matcher keeps four local stages apart because they score differently; a reader only needs to
 * know how strong the argument was in kind, so "dictionary" and "trigram" both read as "synonym".
 */
export type BudgetStageGroup = "exact" | "synonym" | "meaning" | "manual" | "ambiguous" | "unmatched";

const STAGE_GROUPS: Readonly<Record<string, BudgetStageGroup>> = Object.freeze({
  exact: "exact",
  dictionary: "synonym",
  trigram: "synonym",
  embedding: "meaning",
  manual: "manual",
  ambiguous: "ambiguous",
});

export function budgetStageGroup(stage: string): BudgetStageGroup {
  return STAGE_GROUPS[stage] ?? "unmatched";
}

export function budgetConfidence(pair: BudgetProposal): BudgetConfidence {
  if (pair.budgetLabel === null || pair.actualLabel === null) {
    return "none";
  }
  if (pair.score >= BUDGET_CONFIDENCE_HIGH) {
    return "high";
  }
  return pair.score >= BUDGET_CONFIDENCE_MEDIUM ? "medium" : "low";
}

/** The two sides as the owner sees them: matched pairs first, then what is left over on each side. */
export function budgetPairRows(state: BudgetProposalState): readonly BudgetProposal[] {
  const matched = state.pairs.filter((pair) => pair.budgetLabel !== null && pair.actualLabel !== null);
  const budgetOnly = state.pairs.filter((pair) => pair.budgetLabel !== null && pair.actualLabel === null);
  const actualOnly = state.pairs.filter((pair) => pair.budgetLabel === null && pair.actualLabel !== null);
  return [...matched, ...budgetOnly, ...actualOnly];
}

export function budgetUnmatched(state: BudgetProposalState): {
  readonly budget: readonly string[];
  readonly actual: readonly string[];
} {
  return {
    budget: state.pairs.flatMap((pair) => (pair.actualLabel === null && pair.budgetLabel ? [pair.budgetLabel] : [])),
    actual: state.pairs.flatMap((pair) => (pair.budgetLabel === null && pair.actualLabel ? [pair.actualLabel] : [])),
  };
}

function withoutLabels(
  pairs: readonly BudgetProposal[],
  budgetLabel: string | null,
  actualLabel: string | null,
): BudgetProposal[] {
  return pairs.flatMap((pair) => {
    const freedBudget = budgetLabel !== null && pair.budgetLabel === budgetLabel;
    const freedActual = actualLabel !== null && pair.actualLabel === actualLabel;
    if (!freedBudget && !freedActual) {
      return [pair];
    }
    // Whichever half of the old pair was not taken goes back to its bucket rather than vanishing.
    const kept: BudgetProposal[] = [];
    if (!freedBudget && pair.budgetLabel !== null) {
      // The candidates travel with the line: a row pushed back into the bucket must still offer the
      // reader the same one-click choices it offered before someone else took its partner.
      kept.push({
        budgetLabel: pair.budgetLabel,
        actualLabel: null,
        score: 0,
        stage: "unmatched",
        ...(pair.candidates ? { candidates: pair.candidates } : {}),
      });
    }
    if (!freedActual && pair.actualLabel !== null) {
      kept.push({ budgetLabel: null, actualLabel: pair.actualLabel, score: 0, stage: "unmatched" });
    }
    return kept;
  });
}

/**
 * Bind one budget line to one actual line, or to nothing. Never mutates: the owner's edit is a new
 * pairing, and the lines the old pair held are freed rather than quietly dropped.
 */
export function repairBudgetPair(
  pairs: readonly BudgetProposal[],
  budgetLabel: string,
  actualLabel: string | null,
): BudgetProposal[] {
  const freed = withoutLabels(pairs, budgetLabel, actualLabel);
  const was = pairs.find((pair) => pair.budgetLabel === budgetLabel);
  const bound: BudgetProposal =
    actualLabel === null
      ? {
          budgetLabel,
          actualLabel: null,
          score: 0,
          stage: "unmatched",
          ...(was?.candidates ? { candidates: was.candidates } : {}),
        }
      : { budgetLabel, actualLabel, score: 1, stage: "manual" };
  return [bound, ...freed];
}

/** The pairing as the host's schema takes it: labels only, no scores, no stage names. */
export function budgetPairsForRequest(pairs: readonly BudgetProposal[]): BudgetPair[] {
  return pairs
    .filter((pair) => pair.budgetLabel !== null && pair.actualLabel !== null)
    .map((pair) => ({ budgetLabel: pair.budgetLabel, actualLabel: pair.actualLabel }));
}

/**
 * The partners an unmatched line offers as buttons: the ones the matcher ranked highest that are
 * still free. A candidate another line has since taken is dropped rather than shown and refused.
 */
export function budgetTopCandidates(
  state: BudgetProposalState,
  pair: BudgetProposal,
): readonly BudgetCandidate[] {
  if (pair.budgetLabel === null || pair.actualLabel !== null) {
    return [];
  }
  const free = new Set(budgetPartnerOptions(state, pair.budgetLabel));
  return (pair.candidates ?? []).filter((candidate) => free.has(candidate.label));
}

/** The actual lines a given budget line may be bound to: the free ones, plus its own current partner. */
export function budgetPartnerOptions(state: BudgetProposalState, budgetLabel: string): readonly string[] {
  const taken = new Set(
    state.pairs.flatMap((pair) =>
      pair.actualLabel !== null && pair.budgetLabel !== null && pair.budgetLabel !== budgetLabel
        ? [pair.actualLabel]
        : [],
    ),
  );
  const kind = state.budget.find((line) => line.label === budgetLabel)?.kind;
  return state.actual
    .filter((line) => !taken.has(line.label))
    .filter((line) => kind === undefined || line.kind === kind)
    .map((line) => line.label);
}

/** One bar of the variance chart, already scaled against the largest absolute variance drawn. */
export type BudgetBar = {
  readonly label: string;
  readonly value: number;
  readonly flagged: boolean;
  /** 0..100, the share of the half-width this bar fills. */
  readonly widthPercent: number;
  readonly side: "left" | "right";
};

/**
 * The report's variance chart as bars around a zero line. The chart carries two series — the flagged
 * lines and the ones inside the limit — so which bar is which is a fact of the report, not a colour
 * chosen here.
 */
export function budgetBars(chart: ReportChart | undefined): BudgetBar[] {
  if (!chart) {
    return [];
  }
  const flagged = chart.series[0]?.values ?? [];
  const within = chart.series[1]?.values ?? [];
  const values = chart.categories.map((_category, at) => ({
    value: flagged[at] ?? within[at] ?? 0,
    flagged: flagged[at] !== null && flagged[at] !== undefined,
  }));
  const extreme = Math.max(1, ...values.map((entry) => Math.abs(entry.value)));
  return chart.categories.map((label, at) => {
    const entry = values[at] ?? { value: 0, flagged: false };
    return {
      label,
      value: entry.value,
      flagged: entry.flagged,
      widthPercent: (Math.abs(entry.value) / extreme) * 100,
      side: entry.value < 0 ? ("left" as const) : ("right" as const),
    };
  });
}

/** The per-period variance tables the report carries, in the order the periods were read. */
export function budgetPeriodTables(tables: readonly ReportTable[]): readonly ReportTable[] {
  return tables.filter((table) => table.id.startsWith("variance-"));
}

export type BudgetPreview = {
  readonly lines: number;
  readonly flagged: number;
  readonly unmatched: number;
  readonly periods: readonly string[];
  readonly resultVariance: number;
  readonly currency: string;
};

/**
 * What the confirmed rows already say, before anything is narrated.
 *
 * This is the very same `computeBudget` the host will run — core is pure and ships to the browser —
 * so the count shown here and the count in the finished report cannot drift apart. It costs no token
 * and reaches nothing.
 */
export function budgetPreview(items: readonly LineItem[], params: BudgetUiParams): BudgetPreview | null {
  const parsed = budgetInputSchema.safeParse({ items, params });
  if (!parsed.success) {
    return null;
  }
  const computed = computeBudget(parsed.data);
  if (computed.lines.length === 0) {
    return null;
  }
  const result = computed.aggregates.find((aggregate) => aggregate.id === "result");
  return {
    lines: computed.lines.length,
    flagged: computed.flagCounts.total,
    unmatched: computed.budgetOnly.length + computed.actualOnly.length,
    periods: computed.periods.filter((period) => period !== ""),
    resultVariance: result?.total.variance ?? 0,
    currency: computed.currency,
  };
}

function toNumber(raw: string): number | undefined {
  const value = Number(raw);
  return raw.trim() === "" || !Number.isFinite(value) ? undefined : value;
}

/** A threshold box that was cleared drops the key rather than sending NaN to the host. */
export function withBudgetThreshold(
  params: BudgetUiParams,
  key: "flagPct" | "flagAbs",
  raw: string,
): BudgetUiParams {
  const { [key]: _dropped, ...rest } = params;
  const value = toNumber(raw);
  return value === undefined ? rest : { ...rest, [key]: value };
}
