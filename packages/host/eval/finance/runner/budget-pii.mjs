/**
 * The two scores only some cases carry: the budget comparison, and privacy.
 *
 * They are here rather than in scoring.mjs because they answer questions the other
 * scores do not. A budget case can compute every variance perfectly and still be
 * wrong, because it paired the wrong two lines; and a privacy case can be right
 * about every number while having leaked a national ID on the way to the model.
 *
 * Pure. No network, no clock, no filesystem.
 */
import { amountsMatch } from "./numbers.mjs";
import { labelsMatch, normaliseLabel, pairUp, prf, samePeriodClaim } from "./labels.mjs";
/* -------------------------------------------------------------------- budget */

/** A truth field the case wrote as `null` is "there is no such number", not "zero". */
function fieldMatch(expected, stated, tolerance) {
  if (expected === null || expected === undefined) {
    return !Number.isFinite(stated);
  }
  return amountsMatch(expected, stated, tolerance);
}

function pairFieldsMatch(truth, candidate, tolerance) {
  const planned = fieldMatch(truth.planned, candidate.planned, tolerance);
  const actual = fieldMatch(truth.actual, candidate.actual, tolerance);
  const variance = truth.variance === undefined ? true : fieldMatch(truth.variance, candidate.variance, tolerance);
  return { planned, actual, variance, all: planned && actual && variance };
}

/** A pair is the same pair when either side's label is the one the case named. */
function pairLabelsMatch(truth, candidate) {
  const sides = [truth.budgetLabel, truth.actualLabel, truth.label].filter(
    (side) => typeof side === "string" && side !== "",
  );
  const theirs = [candidate.budgetLabel, candidate.actualLabel, candidate.label].filter(
    (side) => typeof side === "string" && side !== "",
  );
  return sides.some((mine) => theirs.some((other) => labelsMatch(mine, other)));
}

function partnerMatch(wanted, stated) {
  if (wanted === undefined) {
    return true;
  }
  return wanted === null ? (stated ?? null) === null : labelsMatch(wanted, stated ?? "");
}

/**
 * Planned-versus-actual, as the budget task proposed it: which budget line was
 * paired with which actual, and what each side is worth. A pair counts only when
 * every field the case declares is right — including the ones it declares absent.
 */
export function scoreBudgetPairs(truthPairs, reportedPairs, options = {}) {
  const truths = Array.isArray(truthPairs) ? truthPairs : [];
  const reported = Array.isArray(reportedPairs) ? reportedPairs : [];
  const tolerance = options.tolerance;
  const { pairs, misses, extras } = pairUp(truths, reported, pairLabelsMatch);
  const checked = pairs.map(({ truth, candidate }) => ({
    label: truth.label ?? truth.budgetLabel ?? truth.actualLabel ?? "",
    fields: pairFieldsMatch(truth, candidate, tolerance),
    /**
     * Did the app pair it with the same partner the case says it has? A case that
     * names no partner at all is not asking; a case that names `null` is asking
     * for exactly one thing — that the app left this line unpaired.
     */
    partnerMatches: partnerMatch(truth.actualLabel, candidate.actualLabel),
    expected: { planned: truth.planned, actual: truth.actual, variance: truth.variance, partner: truth.actualLabel },
    stated: {
      planned: candidate.planned,
      actual: candidate.actual,
      variance: candidate.variance,
      partner: candidate.actualLabel,
    },
  }));
  const correct = checked.filter((entry) => entry.fields.all && entry.partnerMatches);
  return {
    ...prf(correct.length, truths.length, reported.length),
    truthTotal: truths.length,
    reportedTotal: reported.length,
    matched: correct.length,
    mismatches: checked.filter((entry) => !(entry.fields.all && entry.partnerMatches)),
    misses: misses.map((truth) => truth.label ?? truth.budgetLabel ?? truth.actualLabel ?? ""),
    extras: extras.map((extra) => extra.label),
  };
}

/**
 * Every name one truth line answers to.
 *
 * A case flags by slug and the report names the line as the sheet does, so the slug
 * is an ALIAS of that one line — never a second candidate the report could be
 * credited for flagging, and never a second spelling that turns one report row into
 * one hit and one extra.
 */
function namesOf(id, index) {
  const key = normaliseLabel(id);
  const entry = (index ?? []).find(
    (candidate) =>
      normaliseLabel(candidate.id) === key || (candidate.names ?? []).some((name) => normaliseLabel(name) === key),
  );
  return entry ? entry.names : [id];
}

/**
 * One period's flagged set. The report's rows for this period are paired one to one
 * with the case's lines, so a line the case can spell three ways still claims a
 * single row, and a row the report printed twice is an extra rather than a second hit.
 */
function scoreOnePeriod(group, lines, index) {
  const truths = (group.ids ?? []).map((id) => ({ id, names: namesOf(id, index) }));
  const reported = lines.filter((line) => samePeriodClaim(group.period, line.period));
  const { pairs, misses, extras } = pairUp(truths, reported, (truth, line) =>
    truth.names.some((name) => labelsMatch(name, line.label)),
  );
  return {
    period: group.period,
    matched: pairs.length,
    truthTotal: truths.length,
    reportedTotal: reported.length,
    missed: misses.map((truth) => truth.id),
    extra: extras.map((line) => line.label),
  };
}

function total(entries, field) {
  return entries.reduce((sum, entry) => sum + entry[field], 0);
}

/**
 * The lines the case says cross the threshold, against the lines the report flagged —
 * line by line, period by period.
 *
 * `truthGroups` keeps the case's own structure: one full-period group for a yearly
 * list, one per quarter for a quarterly one. Flattening both into a set of names, as
 * this used to, let a line flagged in the wrong quarter answer for the right one, and
 * let the same row be matched twice under two spellings of the same line.
 *
 * A report row under a period the case never names is not scored either way: a period
 * the case says nothing about is not a claim it can be wrong about. The count is
 * reported rather than swallowed.
 */
export function scoreBudgetFlags(truthGroups, reportedLines, options = {}) {
  const groups = Array.isArray(truthGroups) ? truthGroups : [];
  const lines = (Array.isArray(reportedLines) ? reportedLines : []).filter(
    (line) => typeof line?.label === "string" && line.label.trim() !== "",
  );
  const byPeriod = groups.map((group) => scoreOnePeriod(group, lines, options.names));
  const matched = total(byPeriod, "matched");
  const truthTotal = total(byPeriod, "truthTotal");
  const reportedTotal = total(byPeriod, "reportedTotal");
  return {
    ...prf(matched, truthTotal, reportedTotal),
    truthTotal,
    reportedTotal,
    matched,
    missed: byPeriod.flatMap((entry) => entry.missed),
    extra: byPeriod.flatMap((entry) => entry.extra),
    byPeriod,
    /** Rows the report flagged under a period the case never names. Said out loud, not scored. */
    unscoredLines: lines.filter((line) => !groups.some((group) => samePeriodClaim(group.period, line.period))).length,
  };
}

/* ----------------------------------------------------------------------- pii */

function piiKey(entry) {
  return `${entry.kind}:${normaliseLabel(entry.match ?? entry.value ?? "")}`;
}

/** Did the app find the personal data the case planted, and nothing it invented? */
export function scorePii(truthPii, detected) {
  const truths = Array.isArray(truthPii) ? truthPii : [];
  const found = Array.isArray(detected) ? detected : [];
  const foundKeys = new Set(found.map(piiKey));
  const truthKeys = new Set(truths.map(piiKey));
  const hits = truths.filter((entry) => foundKeys.has(piiKey(entry)));
  return {
    ...prf(hits.length, truths.length, found.length),
    truthTotal: truths.length,
    detectedTotal: found.length,
    misses: truths.filter((entry) => !foundKeys.has(piiKey(entry))).map((entry) => entry.kind),
    extras: found.filter((entry) => !truthKeys.has(piiKey(entry))).map((entry) => entry.kind),
  };
}

/** Digits only, for a value whose punctuation the app may legitimately have changed. */
function digitsOf(value) {
  const digits = String(value).replace(/\D+/g, "");
  return digits.length >= 8 ? digits : null;
}

/**
 * The hard one: did any planted value survive into something the model could see?
 *
 * The harness cannot read the prompt the host builds, so it scores the next best
 * thing — everything that came back out of the app on the way there: the figures
 * text the import produced, the prose the report carries, and every sheet preview
 * the import offered. A value found in any of those is a leak, named with the
 * place it was found. Values the case says must SURVIVE (a bank's name is not
 * personal data and a payroll report is useless without it) are checked the other
 * way round.
 */
export function scorePiiLeak(truthPii, seen, options = {}) {
  const truths = Array.isArray(truthPii) ? truthPii : [];
  const places = Object.entries(seen ?? {}).filter(([, text]) => typeof text === "string" && text !== "");
  const leaks = [];
  for (const entry of truths) {
    const value = entry?.value;
    if (typeof value !== "string" || value.trim() === "") {
      continue;
    }
    const digits = digitsOf(value);
    for (const [where, text] of places) {
      const verbatim = text.includes(value);
      const stripped = !verbatim && digits !== null && text.replace(/\D+/g, "").includes(digits);
      if (verbatim || stripped) {
        leaks.push({ kind: entry.kind, where, cell: entry.cell ?? null, form: verbatim ? "verbatim" : "digits-only" });
        break;
      }
    }
  }
  const mustRemain = Array.isArray(options.mustRemain) ? options.mustRemain : [];
  const dropped = mustRemain.filter((needle) => !places.some(([, text]) => text.includes(needle)));
  return {
    checkedPlaces: places.map(([where]) => where),
    truthTotal: truths.length,
    leaks,
    leaked: leaks.length,
    /** Values that are not personal data and must survive redaction. */
    mustRemain: {
      checked: mustRemain.length > 0,
      total: mustRemain.length,
      dropped,
      why: options.mustRemainWhy ?? null,
    },
  };
}
