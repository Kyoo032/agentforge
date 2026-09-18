/**
 * Did the finished report state the figures the raw data really implies?
 *
 * The rule, in one line: **a figure is matched by its value and its unit; its name
 * is only ever used to tell two cells with the same value apart.** A task decides
 * for itself whether a number belongs on a KPI tile, in a table or on a chart, and
 * an eval that insisted on one of those would be scoring layout rather than
 * accuracy.
 *
 * WRONG stays strict and rare, because it is the harshest verdict a case can
 * collect (it counts twice against the penalised score). A figure is WRONG only
 * when the report states the SAME metric — every significant word of the truth's
 * own name, at the same period — with a different value. A number the report never
 * mentions is MISSING, which is a different problem with a different fix.
 *
 * Pure. No network, no clock, no filesystem.
 */
import { amountsMatch, extractFigures, figureValues, isFreeFigure, unitsCompatible } from "./numbers.mjs";
import { normaliseLabel, periodsMatch } from "./labels.mjs";
import { cellUnitAllows, localeOfReport, reportCells, reportProse, tokensOf } from "./report-cells.mjs";

export const FIGURE_VERDICTS = ["FOUND_STRUCTURED", "FOUND_PROSE", "ABSENT_OK", "WRONG", "MISSING"];
/** Verdicts that count as "the report got this figure right". */
const GOOD_VERDICTS = new Set(["FOUND_STRUCTURED", "FOUND_PROSE", "ABSENT_OK"]);
/** A wrong figure is worse than a missing one: it is counted twice against the score. */
export const WRONG_FIGURE_PENALTY = 2;

const SENTENCE_SPLIT = /(?<=[.!?])\s+|\n+/;
/**
 * A period, as a truth key carries it on its tail (`netCash.Jan 2024`,
 * `grossMarginPct.2024`) or as a label ends with one ("Gross margin 2025").
 *
 * Only a MONTH may precede the year. Allowing any word would read "margin 2025"
 * as the period, which would make every label its own period and no two would
 * ever agree.
 */
const MONTH = [
  "januari|january|jan",
  "februari|february|feb",
  "maret|march|mar",
  "april|apr",
  "mei|may",
  "juni|june|jun",
  "juli|july|jul",
  "agustus|august|agt|agu|aug",
  "september|sept|sep",
  "oktober|october|okt|oct",
  "nopember|november|nov",
  "desember|december|des|dec",
].join("|");
/** `\b` on both sides, so "margin" is not read as the month "mar" plus a suffix. */
const MONTH_WORD = `(?:\\b(?:${MONTH})\\b\\s)?`;
const KEY_PERIOD = new RegExp(`^${MONTH_WORD}(?:19|20)\\d{2}$`, "i");
const TRAILING_PERIOD = new RegExp(`(${MONTH_WORD}(?:19|20)\\d{2})\\s*$`, "i");

/** The period this truth figure is about, from its key's tail or its label's. */
export function figurePeriod(figure) {
  const segments = String(figure?.key ?? "").split(".");
  const tail = segments.length > 1 ? segments[segments.length - 1] : "";
  if (tail && KEY_PERIOD.test(tail.trim())) {
    return tail.trim();
  }
  return TRAILING_PERIOD.exec(String(figure?.label ?? ""))?.[1] ?? "";
}

/** The key's dotted head as words: `currentRatio.2024` → `current ratio`. */
function keyWords(figure) {
  return String(figure?.key ?? "")
    .split(".")[0]
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]+/g, " ");
}

/**
 * The words that identify this figure: the case's own LABEL, which is written in
 * the same language as the report it is about.
 *
 * The key is deliberately not in here. A case keys `currentRatio.2024` and labels
 * it "Rasio lancar 2024"; requiring "current" and "ratio" to appear as well would
 * mean no Indonesian report could ever be recognised as talking about it, and
 * every contradiction would be filed as a polite MISSING. The key stands in only
 * when the case wrote no label at all.
 */
export function figureTokens(figure) {
  const fromLabel = tokensOf(figure?.label);
  return fromLabel.length > 0 ? fromLabel : tokensOf(keyWords(figure));
}

/** The key's words, as an extra hint when two cells are otherwise tied. */
export function figureHints(figure) {
  return tokensOf(keyWords(figure));
}

/**
 * Do the figure and the cell agree about when?
 *
 * A table column states its period in a field; a KPI tile states it inside its own
 * label ("Net margin 2025") and leaves the field empty. Both are the report saying
 * the same thing, so an empty period field is accepted only when the cell's WORDS
 * carry the period instead — never as a free pass.
 */
function periodAgrees(figure, cell) {
  const want = figurePeriod(figure);
  if (want === "") {
    return true;
  }
  if (periodsMatch(want, cell.period)) {
    return true;
  }
  return cell.period === "" && tokensOf(want).every((token) => cell.tokens.includes(token));
}

/**
 * Is this cell about the same metric as this figure?
 *
 * Every significant word of the truth's own name must be in the cell's OWN words —
 * its row name and its column header — and the periods must agree. The table's
 * title is deliberately excluded: a table headed `Rasio antar periode` would
 * otherwise lend the word `rasio` to every row in it, and the row `Jumlah aset
 * lancar` would be read as a statement about the current RATIO, its value compared
 * against 1.6, and the report called WRONG for stating its own assets correctly.
 * The title still helps pick which cell to NAME once a value has matched.
 *
 * Set deliberately high: this predicate is what turns MISSING into WRONG.
 */
export function sameMetric(figure, cell) {
  const want = figureTokens(figure);
  if (want.length === 0) {
    return false;
  }
  const have = new Set(cell.ownTokens ?? cell.tokens);
  return want.every((token) => have.has(token)) && periodAgrees(figure, cell);
}

function matchesValue(figure, cell) {
  return (
    cellUnitAllows(figure.unit ?? "number", cell.unit, unitsCompatible) &&
    amountsMatch(figure.value, cell.value, figure.tolerance)
  );
}

/**
 * Which of the cells that carry this value the trace should name. The case's own
 * label first; failing that, a cell whose words overlap the key (`currentRatio`
 * against a column headed "Current ratio"); failing that, the first one found.
 */
function hit(figure, candidates) {
  const named = candidates.filter((cell) => sameMetric(figure, cell));
  const hinted =
    named.length > 0
      ? named
      : candidates.filter((cell) => figureHints(figure).some((hint) => cell.tokens.includes(hint)));
  const chosen = hinted[0] ?? candidates[0];
  return {
    verdict: "FOUND_STRUCTURED",
    where: chosen.where,
    stated: chosen.value,
    cell: chosen.name,
    /** How many cells carried this value; > 1 means the name is what settled it. */
    candidates: candidates.length,
    disambiguatedByName: hinted.length > 0 && candidates.length > 1,
  };
}

function figureMatchesToken(figure, found) {
  return figureValues(found).some((value) => amountsMatch(figure.value, value, figure.tolerance));
}

/**
 * A sentence that names the figure and states a number of the right kind, but the
 * wrong one. Returns the value it stated, so the trace names the contradiction
 * rather than only asserting there was one.
 */
function proseContradicts(figure, narrative, locale) {
  const words = figureTokens(figure);
  if (words.length === 0) {
    return null;
  }
  for (const sentence of narrative.split(SENTENCE_SPLIT)) {
    const flat = normaliseLabel(sentence);
    if (!words.every((word) => flat.includes(word))) {
      continue;
    }
    const stated = extractFigures(sentence, locale).filter(
      (found) => !isFreeFigure(found) && unitsCompatible(figure.unit, found.unit),
    );
    if (stated.length > 0 && !stated.some((found) => figureMatchesToken(figure, found))) {
      return { value: stated[0].value, sentence: sentence.trim().slice(0, 200) };
    }
  }
  return null;
}

/**
 * A truth figure whose value is `null`: the case says there is no such number.
 *
 * "The report states a number for it" has to mean a number of the RIGHT KIND. A
 * budget line that exists only in the actuals has no budget to divide by, so its
 * variance % is not defined — and the variance in money beside it answers to every
 * word of that figure's name once the `%` normalises away. Calling the report wrong
 * for printing its own correct amount is the harness inventing a contradiction.
 */
function verdictForAbsent(figure, cells) {
  const stated = cells.find(
    (cell) => sameMetric(figure, cell) && cellUnitAllows(figure.unit ?? "number", cell.unit, unitsCompatible),
  );
  return stated
    ? {
        verdict: "WRONG",
        where: stated.where,
        stated: stated.value,
        cell: stated.name,
        evidence: "the case says this figure is not defined; the report states a number for it",
      }
    : { verdict: "ABSENT_OK", where: null, stated: null };
}

function verdictFor(figure, cells, prose, locale) {
  if (figure.value === null) {
    return verdictForAbsent(figure, cells);
  }
  const matched = cells.filter((cell) => matchesValue(figure, cell));
  if (matched.length > 0) {
    return hit(figure, matched);
  }
  const inProse = extractFigures(prose, locale).find(
    (found) => unitsCompatible(figure.unit, found.unit) && figureMatchesToken(figure, found),
  );
  if (inProse) {
    return { verdict: "FOUND_PROSE", where: "narrative", stated: inProse.value };
  }
  // Nothing in the report carries this value. Only a cell that is demonstrably
  // about the SAME metric makes it a contradiction rather than an omission.
  const contradicting = cells.find((cell) => sameMetric(figure, cell));
  if (contradicting) {
    return {
      verdict: "WRONG",
      where: contradicting.where,
      stated: contradicting.value,
      cell: contradicting.name,
      evidence: `same metric, different value (expected ${figure.value})`,
    };
  }
  const inSentence = proseContradicts(figure, prose, locale);
  return inSentence
    ? { verdict: "WRONG", where: "narrative", stated: inSentence.value, evidence: inSentence.sentence }
    : { verdict: "MISSING", where: null, stated: null };
}

function tally(scored) {
  const total = scored.length;
  const found = scored.filter((entry) => GOOD_VERDICTS.has(entry.verdict)).length;
  const wrong = scored.filter((entry) => entry.verdict === "WRONG").length;
  return {
    total,
    found,
    wrong,
    missing: total - found - wrong,
    accuracy: total === 0 ? 1 : found / total,
    wrongRate: total === 0 ? 0 : wrong / total,
    penalisedAccuracy: total === 0 ? 1 : Math.max(0, (found - WRONG_FIGURE_PENALTY * wrong) / total),
    figures: scored,
  };
}

/**
 * Every truth figure against the finished report.
 *
 * Three blocks come back beside the headline tally, because they answer different
 * questions and averaging them would hide all three:
 *
 * - `structured` — figures the report was expected to compute and show.
 * - `prose` — figures a case marks `"source": "prose"`, argued in the narrative.
 * - `naFigures` — truth figures whose value is `null`. The case is saying the
 *   number is not defined, so the right answer is silence; these are NOT in the
 *   headline accuracy, because a case with ten of them could otherwise score well
 *   by saying nothing at all.
 */
export function scoreFigures(truthFigures, view, options = {}) {
  // The app's own words are read in the app's own number culture, not the case's.
  const locale = localeOfReport(view, options.locale);
  const cells = reportCells(view);
  const prose = reportProse(view);
  const scored = (Array.isArray(truthFigures) ? truthFigures : []).map((figure) => ({
    key: figure.key,
    label: figure.label,
    expected: figure.value,
    unit: figure.unit ?? "number",
    source: figure.source ?? "structured",
    period: figurePeriod(figure),
    ...verdictFor(figure, cells, prose, locale),
  }));
  const na = scored.filter((entry) => entry.expected === null);
  const real = scored.filter((entry) => entry.expected !== null);
  return {
    ...tally(real),
    structured: tally(real.filter((entry) => entry.source !== "prose")),
    prose: tally(real.filter((entry) => entry.source === "prose")),
    naFigures: tally(na),
    cellsRead: cells.length,
    proseChars: prose.length,
    readAs: locale,
  };
}
