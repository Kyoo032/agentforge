/**
 * Label and period normalisation for the accuracy scorer.
 *
 * The rule the whole harness turns on: a label is forgiven its *typography* and
 * nothing else. Case, accents, punctuation, spacing and a trailing colon all
 * normalise away, because none of them change what a reader understands. A
 * different word does change it — "Pendapatan" is not "Revenue", "Gross profit"
 * is not "Net profit" — so synonyms, translations and near-misses are wrong, and
 * the harness says so. Softening that would let a model rename the owner's rows
 * and still score 100 %.
 */

const DIACRITIC = /[̀-ͯ]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

/** Lowercase, unaccented, single-spaced. Nothing else is touched. */
export function normaliseLabel(value) {
  if (typeof value !== "string") {
    return "";
  }
  return value.normalize("NFD").replace(DIACRITIC, "").toLowerCase().replace(NON_ALPHANUMERIC, " ").trim();
}

/** Fiscal-year prefixes and punctuation are noise; the period itself is not. */
const FY_PREFIX = /^(?:fy|ty|th|tahun)\s*/;

export function normalisePeriod(value) {
  const base = normaliseLabel(value).replace(FY_PREFIX, "").trim();
  return base.replace(/\s+/g, "");
}

export function periodsMatch(truth, candidate) {
  const left = normalisePeriod(truth);
  const right = normalisePeriod(candidate);
  if (left === right) {
    return true;
  }
  // An undated truth row accepts any period: the case simply did not pin one.
  return left === "";
}

export function labelsMatch(truth, candidate) {
  return normaliseLabel(truth) === normaliseLabel(candidate);
}

/**
 * "Over the whole thing": the period a yearly case means when it names none, and
 * the one a report writes its roll-up rows under.
 */
const FULL_PERIOD = /^(?:fy|full year|full period|seluruh periode|tahun penuh|setahun|total)$/;
/** The period key a case's flat list is read under, in the report's own words. */
export const FULL_PERIOD_KEY = "full period";

export function isFullPeriod(value) {
  return FULL_PERIOD.test(normaliseLabel(value));
}

/**
 * Are these two period names the same CLAIM?
 *
 * Deliberately not `periodsMatch`, which forgives an empty truth period because an
 * undated truth row simply did not pin one. `FY` normalises to nothing under that
 * rule — the fiscal-year prefix is stripped — so a full-year claim would silently
 * match Q1, Q2 and Q3 as well, and a report that flagged a line in the wrong
 * quarter would score as though it had flagged the right one.
 */
export function samePeriodClaim(left, right) {
  if (isFullPeriod(left) && isFullPeriod(right)) {
    return true;
  }
  const one = normalisePeriod(left);
  return one !== "" && one === normalisePeriod(right);
}

/**
 * Greedy one-to-one pairing. Candidates are consumed as they are claimed, so a
 * report that repeats the same row twice keeps the first and leaves the second
 * as an extra — which is exactly how a double-counted subtotal should read.
 */
export function pairUp(truths, candidates, matches) {
  const taken = new Set();
  const pairs = [];
  const misses = [];
  for (const truth of truths) {
    const at = candidates.findIndex((candidate, index) => !taken.has(index) && matches(truth, candidate));
    if (at === -1) {
      misses.push(truth);
      continue;
    }
    taken.add(at);
    pairs.push({ truth, candidate: candidates[at], at });
  }
  const extras = candidates.filter((_, index) => !taken.has(index));
  return { pairs, misses, extras };
}

export function f1Score(precision, recall) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

/** precision / recall / F1 from the three counts, with 0/0 defined as 1 for an empty truth set. */
export function prf(truePositives, truthTotal, candidateTotal) {
  const precision = candidateTotal === 0 ? (truthTotal === 0 ? 1 : 0) : truePositives / candidateTotal;
  const recall = truthTotal === 0 ? 1 : truePositives / truthTotal;
  return { precision, recall, f1: truthTotal === 0 && candidateTotal === 0 ? 1 : f1Score(precision, recall) };
}
