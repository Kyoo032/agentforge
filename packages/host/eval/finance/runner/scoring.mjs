/**
 * The scorer. Pure functions only — no network, no filesystem, no clock — so the
 * number a case ends with is reproducible and can be argued with.
 *
 * What it answers, in the owner's words: did the app read the owner's own rows
 * back correctly, did the report state the figures the raw data really implies,
 * and did it state anything the raw data does not support?
 *
 * The figure half lives in `figures.mjs`, which is long enough to be its own
 * argument; it is re-exported here so callers still have one door.
 */
import { UNVERIFIED_MARKER } from "./ts-bridge.mjs";
import { amountsMatch, extractFigures, figureValues, isFreeFigure } from "./numbers.mjs";
import { labelsMatch, pairUp, periodsMatch, prf } from "./labels.mjs";
import { FIGURE_VERDICTS, WRONG_FIGURE_PENALTY, scoreFigures } from "./figures.mjs";
import { scoreBudgetFlags, scoreBudgetPairs, scorePii, scorePiiLeak } from "./budget-pii.mjs";

// One door for callers: the figure half and the budget/privacy half are separate
// files because each is long enough to be its own argument, not because a caller
// should have to know which is which.
export { FIGURE_VERDICTS, WRONG_FIGURE_PENALTY, scoreFigures };
export { scoreBudgetFlags, scoreBudgetPairs, scorePii, scorePiiLeak };

/** A case passes only on all of these. Named here so a threshold can never be tuned in silence. */
export const PASS_EXTRACTION_F1 = 0.9;
export const PASS_FIGURE_ACCURACY = 0.9;
export const PASS_MAX_WRONG_RATE = 0.02;
export const PASS_MAX_HALLUCINATED = 0;
/**
 * The two gates a budget case adds. Pairing the wrong two lines and flagging the
 * wrong ones are the failures this task exists to avoid, and neither shows up in
 * figure accuracy — a perfectly computed variance between the wrong two rows is
 * still the wrong answer.
 */
export const PASS_BUDGET_PAIR_F1 = 0.9;
export const PASS_BUDGET_FLAGGED_F1 = 0.9;

/* ------------------------------------------------------------------ extraction */

function lineItemMatches(truth, candidate, tolerance) {
  return (
    labelsMatch(truth.label, candidate.label) &&
    periodsMatch(truth.period ?? "", candidate.period ?? "") &&
    amountsMatch(truth.amount, candidate.amount, tolerance)
  );
}

/** An extra whose amount is the sum of two or more truth rows is a double-counted subtotal. */
function subtotalOf(extra, truths) {
  const pool = truths.filter((truth) => periodsMatch(truth.period ?? "", extra.period ?? ""));
  const total = pool.reduce((sum, truth) => sum + truth.amount, 0);
  if (pool.length >= 2 && amountsMatch(total, extra.amount, undefined)) {
    return pool.map((truth) => truth.label);
  }
  const positives = pool.filter((truth) => truth.amount > 0);
  const positiveTotal = positives.reduce((sum, truth) => sum + truth.amount, 0);
  return positives.length >= 2 && amountsMatch(positiveTotal, extra.amount, undefined)
    ? positives.map((truth) => truth.label)
    : null;
}

/**
 * Why this row is in the parse and not in the truth. Named rather than lumped
 * together, because the three cases need three different fixes:
 *
 * - `double_counted_subtotal` — a total the parse kept as if it were a line.
 * - `zero_filled_grid_cell` — a row the parse invented at 0 so that every label
 *   has a cell in every period. It still counts against precision (the owner is
 *   shown a row the sheet does not contain), but it is not the app misreading a
 *   figure and a fix wave should not treat it as one.
 * - `not_in_truth` — a row the sheet does not contain at all.
 */
function extraReason(extra, truths) {
  const subtotal = subtotalOf(extra, truths);
  if (subtotal) {
    return { reason: "double_counted_subtotal", subtotalOf: subtotal };
  }
  const namedElsewhere = extra.amount === 0 && truths.some((truth) => labelsMatch(truth.label, extra.label));
  return { reason: namedElsewhere ? "zero_filled_grid_cell" : "not_in_truth", subtotalOf: null };
}

/** Which of the three fields a near-miss actually got wrong — the line a fix wave reads. */
function missReason(truth, candidates, tolerance) {
  const sameLabel = candidates.filter((candidate) => labelsMatch(truth.label, candidate.label));
  // The row is there, at the right period and the right amount, under another
  // name: the app renamed or translated the owner's own label.
  const renamed = candidates.some(
    (candidate) =>
      !labelsMatch(truth.label, candidate.label) &&
      periodsMatch(truth.period ?? "", candidate.period ?? "") &&
      amountsMatch(truth.amount, candidate.amount, tolerance),
  );
  if (renamed) {
    return "label_mismatch";
  }
  if (sameLabel.length === 0) {
    return "label_absent";
  }
  if (!sameLabel.some((candidate) => periodsMatch(truth.period ?? "", candidate.period ?? ""))) {
    return "period_mismatch";
  }
  return sameLabel.some((candidate) => amountsMatch(truth.amount, candidate.amount, tolerance))
    ? "duplicate_claimed"
    : "amount_mismatch";
}

/**
 * Did the confirm step end up holding the rows the raw file really contains?
 * Precision, recall and F1 over (label, period, amount) triples.
 *
 * `parsedLineItems` is whatever the task's adapter flattened the parse into; the
 * adapter says which shape it took and this function does not care.
 */
export function scoreExtraction(truthLineItems, parsedLineItems, options = {}) {
  const truths = Array.isArray(truthLineItems) ? truthLineItems : [];
  const parsed = Array.isArray(parsedLineItems) ? parsedLineItems : [];
  const tolerance = options.tolerance;
  const { pairs, misses, extras } = pairUp(truths, parsed, (truth, candidate) =>
    lineItemMatches(truth, candidate, tolerance),
  );
  return {
    ...prf(pairs.length, truths.length, parsed.length),
    scorable: true,
    via: options.via ?? null,
    truthTotal: truths.length,
    parsedTotal: parsed.length,
    matched: pairs.length,
    misses: misses.map((truth) => ({ ...truth, reason: missReason(truth, parsed, tolerance) })),
    extras: extras.map((extra) => ({ ...extra, ...extraReason(extra, truths) })),
  };
}

/**
 * The task's parse shape cannot express `truth.lineItems` at all. Said out loud,
 * with no number attached — "0.000" would read as "the app got every row wrong",
 * which is a different and much worse claim.
 */
export function unscorableExtraction(why, shapes) {
  return {
    scorable: false,
    why,
    shapes: shapes ?? {},
    precision: null,
    recall: null,
    f1: null,
    truthTotal: 0,
    parsedTotal: 0,
    matched: 0,
    misses: [],
    extras: [],
  };
}

/* ---------------------------------------------------------------- hallucination */

/**
 * Numbers in the narrative that trace to nothing: not an input row, not a truth
 * figure, not a computed metric. Calendar years and small counts are free, the
 * same way the product's own guard frees them.
 *
 * This check is about PROVENANCE, not sign — which is why it compares magnitudes.
 *
 * Prose carries the sign in its words: "an outlay of 820,000", "cash flow turns
 * negative at 65,000", "(151.000)" as a bracketed aside that the accounting
 * convention would read as a minus. Every one of those is a number the app really
 * computed, written the way a person writes it, and calling them inventions says
 * something false about the app. A sign that is genuinely WRONG is caught by
 * `scoreFigures`, which stays strictly signed — so nothing is lost by scoping this
 * one to "did this number come from somewhere at all?".
 */
function tracesBack(figure, magnitudes) {
  return figureValues(figure).some((value) => magnitudes.some((ok) => amountsMatch(ok, Math.abs(value), undefined)));
}

export function scoreHallucination(prose, allowedNumbers, options = {}) {
  const locale = options.locale ?? "en";
  const narrative = typeof prose === "string" ? prose : (prose?.narrative ?? "");
  const allowed = (allowedNumbers ?? []).filter((value) => Number.isFinite(value));
  const magnitudes = allowed.map((value) => Math.abs(value));
  const hallucinated = extractFigures(narrative, locale)
    .filter((figure) => !isFreeFigure(figure))
    .filter((figure) => !tracesBack(figure, magnitudes))
    .map((figure) => ({ text: figure.text, value: figure.value, unit: figure.unit, index: figure.index }));
  const markers = narrative.split(UNVERIFIED_MARKER).length - 1;
  return { hallucinated, count: hallucinated.length, unverifiedMarkers: markers, allowedCount: allowed.length };
}

/* ------------------------------------------------------------------- pass rule */

/** Phrases the case forbids. Compared case-insensitively on the whole report text. */
export function forbiddenPresent(text, mustNotContain) {
  const haystack = (text ?? "").toLowerCase();
  return (mustNotContain ?? []).filter((phrase) => haystack.includes(String(phrase).toLowerCase()));
}

export function missingMentions(text, mustMention) {
  const haystack = (text ?? "").toLowerCase();
  return (mustMention ?? []).filter((phrase) => !haystack.includes(String(phrase).toLowerCase()));
}

/**
 * The one rule the owner's 90 % goal is measured by. Every clause is a hard gate:
 * a report that hallucinates one number fails however good the rest of it is.
 *
 * An extraction the task's shape could not express is not silently a pass: the
 * case fails with the shape's own explanation, because an unmeasured case is not
 * a passing one.
 */
export function casePasses(scores) {
  const reasons = [];
  if (scores.extraction.scorable === false) {
    reasons.push(`extraction not measurable: ${scores.extraction.why}`);
  } else if (scores.extraction.f1 < PASS_EXTRACTION_F1) {
    reasons.push(`extraction F1 ${scores.extraction.f1.toFixed(3)} < ${PASS_EXTRACTION_F1}`);
  }
  if (scores.figures.accuracy < PASS_FIGURE_ACCURACY) {
    reasons.push(`figure accuracy ${scores.figures.accuracy.toFixed(3)} < ${PASS_FIGURE_ACCURACY}`);
  }
  if (scores.figures.wrongRate > PASS_MAX_WRONG_RATE) {
    reasons.push(`wrongRate ${scores.figures.wrongRate.toFixed(3)} > ${PASS_MAX_WRONG_RATE}`);
  }
  if (scores.figures.naFigures.wrong > 0) {
    reasons.push(`${scores.figures.naFigures.wrong} figure(s) the case says are not defined were given a number`);
  }
  if (scores.budget && scores.budget.f1 < PASS_BUDGET_PAIR_F1) {
    reasons.push(`budget pair F1 ${scores.budget.f1.toFixed(3)} < ${PASS_BUDGET_PAIR_F1}`);
  }
  if (scores.budgetFlags && scores.budgetFlags.f1 < PASS_BUDGET_FLAGGED_F1) {
    reasons.push(`flagged-set F1 ${scores.budgetFlags.f1.toFixed(3)} < ${PASS_BUDGET_FLAGGED_F1}`);
  }
  if (scores.hallucination.count > PASS_MAX_HALLUCINATED) {
    reasons.push(`${scores.hallucination.count} hallucinated figure(s)`);
  }
  if ((scores.forbidden ?? []).length > 0) {
    reasons.push(`forbidden text present: ${scores.forbidden.join(", ")}`);
  }
  if ((scores.piiLeak?.leaked ?? 0) > 0) {
    reasons.push(
      `${scores.piiLeak.leaked} planted personal value(s) reached ${[...new Set(scores.piiLeak.leaks.map((leak) => leak.where))].join(", ")}`,
    );
  }
  return { pass: reasons.length === 0, reasons };
}
