/**
 * One case, start to finish, exactly as a person would drive the studio:
 * upload → read the figures → confirm the rows → generate → export.
 *
 * Two rules hold this file together.
 *
 * 1. **Nothing is scored that did not run.** There is no truth-row stand-in and no
 *    deterministic brief behind a failed stage. A stage that could not run ends the
 *    case there, with the app's own words, and no score column is filled. Scoring a
 *    fallback against the very rows it was seeded from produced a perfect 1.000 for
 *    a case whose parse had fallen over, which is the most expensive kind of wrong a
 *    harness can be.
 * 2. **Each task is driven the way its own step component drives it.** The task
 *    adapter builds the parse, generate and export bodies; stages.mjs makes the
 *    calls; this file only sequences them and scores what came back.
 */
import { adapterFor } from "./adapters/index.mjs";
import {
  allowedNumbers,
  budgetPairsFrom,
  flaggedLinesFrom,
  piiFrom,
  scorableReport,
  workbookCoverage,
} from "./report-view.mjs";
import { FULL_PERIOD_KEY } from "./labels.mjs";
import { localeOfReport } from "./report-cells.mjs";
import { amountsMatch } from "./numbers.mjs";
import {
  casePasses,
  forbiddenPresent,
  missingMentions,
  scoreBudgetFlags,
  scoreBudgetPairs,
  scoreExtraction,
  scoreFigures,
  scoreHallucination,
  scorePii,
  scorePiiLeak,
  unscorableExtraction,
} from "./scoring.mjs";
import {
  DEFAULT_EXPORT_FORMATS,
  StageStopped,
  describe,
  exportStage,
  generateStage,
  importStage,
  parseStage,
} from "./stages.mjs";
import { CASE_STATUS, verdictForScoredCase, verdictForStoppedCase } from "./verdict.mjs";

export { CASE_STATUS, DEFAULT_EXPORT_FORMATS };
/* ---------------------------------------------------------------------- scores */

/**
 * Budget cases write their truth as `variances` — a budget row paired with its
 * actual, sometimes per quarter with a `fullYear` roll-up. `null` on either label
 * is a real statement ("this line has no partner"), and it is kept as null rather
 * than coerced into a name that does not exist.
 */
export function budgetTruthPairs(truth) {
  if (Array.isArray(truth.budgetPairs)) {
    return truth.budgetPairs;
  }
  if (!Array.isArray(truth.variances)) {
    return null;
  }
  return truth.variances.map((entry) => ({
    label: entry.budgetLabel ?? entry.actualLabel ?? entry.label ?? entry.slug ?? "",
    // Only a case that NAMES both sides is asking about the pairing. A case that
    // writes one name per line — a quarterly sheet where both sides are the same
    // row — is asking about the numbers, and asserting a partner it never named
    // would fail it on a question it did not put.
    ...("budgetLabel" in entry ? { budgetLabel: entry.budgetLabel ?? null } : {}),
    ...("actualLabel" in entry ? { actualLabel: entry.actualLabel ?? null } : {}),
    planned: entry.budget ?? entry.fullYear?.budget ?? null,
    actual: entry.actual ?? entry.fullYear?.actual ?? null,
    variance: entry.variance ?? entry.fullYear?.variance,
  }));
}

/**
 * The flagged lines a case names, kept in the shape the case wrote them in.
 *
 * A yearly case writes one list, which is a claim about the FULL period; a quarterly
 * case writes one list per period, and Q3 is a different claim from the year. Both
 * used to flatten to a single set of names, which let a line flagged in one quarter
 * answer for the same line in another — the exact failure this task exists to find.
 */
export function truthFlaggedGroups(truth) {
  const flagged = truth?.flagged;
  if (Array.isArray(flagged)) {
    return [{ period: FULL_PERIOD_KEY, ids: flagged.map((entry) => String(entry)) }];
  }
  if (flagged && typeof flagged === "object") {
    return Object.entries(flagged)
      .filter(([, ids]) => Array.isArray(ids))
      .map(([period, ids]) => ({ period, ids: ids.map((entry) => String(entry)) }));
  }
  return null;
}

/**
 * Every name a case has for one budget line: its own label, the two sheet labels it
 * was read from, and the slug it is flagged by. They are one line, so the flag score
 * can treat the slug as an alias rather than as a second line to find.
 */
export function budgetLineNames(truth) {
  const variances = Array.isArray(truth?.variances) ? truth.variances : [];
  return variances.map((entry) => ({
    id: String(entry.slug ?? entry.label ?? entry.budgetLabel ?? entry.actualLabel ?? ""),
    names: [entry.label, entry.budgetLabel, entry.actualLabel, entry.slug].filter(
      (name) => typeof name === "string" && name.trim() !== "",
    ),
  }));
}

/** The values a case says must SURVIVE redaction, and why the check could not run. */
function mustRemainFor(kase) {
  const declared = kase.truth?.piiMustRemain ?? kase.piiSummary?.mustRemain;
  if (Array.isArray(declared) && declared.length > 0) {
    return { mustRemain: declared, mustRemainWhy: null };
  }
  const hasBank = (kase.pii ?? kase.truth?.pii ?? []).some((entry) => /bank/i.test(entry.kind ?? ""));
  return {
    mustRemain: [],
    mustRemainWhy: hasBank
      ? `the case plants bank data but declares nothing that must survive redaction; add the bank names at cases/${kase.id}/case.json → piiSummary.mustRemain`
      : null,
  };
}

function scoreEverything(kase, extraction, view, parsed, seen, exported) {
  const truth = kase.truth ?? {};
  // The app's own words are read in the number culture the app WROTE them in. The
  // host writes a task's report in the locale its process runs in, so an `en` case
  // can legitimately come back in Indonesian — and reading "-151.000" as English
  // there turns minus a hundred and fifty-one thousand into an invention.
  const locale = localeOfReport(view, kase.locale);
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const allowed = allowedNumbers(items, view, truth, kase.params, { locale });
  const scores = {
    extraction,
    figures: scoreFigures(truth.figures ?? [], view, { locale }),
    hallucination: scoreHallucination(view.prose, allowed, { locale }),
    forbidden: forbiddenPresent(view.text, truth.mustNotContain),
    missingMentions: missingMentions(view.text, truth.mustMention),
    workbook: workbookCoverage(truth.figures ?? [], exported.workbook, amountsMatch),
    exportArtefacts: { summary: exported.summary, calc: exported.calc, deck: exported.deck },
  };
  const pairs = budgetTruthPairs(truth);
  if (pairs) {
    scores.budget = scoreBudgetPairs(pairs, budgetPairsFrom(view));
  }
  const flagged = truthFlaggedGroups(truth);
  if (flagged) {
    // A case names its lines by slug; the report names them as the sheet does. The
    // case's own variances bridge the two — as aliases of one line, not as two.
    scores.budgetFlags = scoreBudgetFlags(flagged, flaggedLinesFrom(view), { names: budgetLineNames(truth) });
  }
  // A case may plant its personal data at the top level or under `truth`.
  const pii = kase.pii ?? truth.pii;
  if (pii) {
    scores.pii = scorePii(pii, piiFrom(view));
    scores.piiLeak = scorePiiLeak(pii, seen, mustRemainFor(kase));
  }
  return scores;
}

/* ------------------------------------------------------------------- the case */

async function driveCase(ctx, kase) {
  const adapter = adapterFor(kase.task);
  const imported = await importStage(ctx, kase);
  const parsed = await parseStage(
    ctx,
    { ...kase, figuresText: imported.figuresText, proseText: imported.proseText },
    adapter,
  );
  // The case comes with the rows, so an adapter can say which parse shape answers which
  // truth row — the brief's subtotals are answered from `derived`. It can only ever drop
  // a row the parse proposed; nothing here can invent one.
  const rows = adapter.extractionRows(parsed.parsed, kase);
  const generated = await generateStage(ctx, adapter.generateBody(kase, parsed.parsed));
  const view = scorableReport(generated.result, { task: kase.task, locale: kase.locale });
  const exported = await exportStage(ctx, kase, adapter, generated.result, view.report);
  const extraction = rows.rows
    ? scoreExtraction(kase.truth?.lineItems ?? [], rows.rows, { via: rows.via, note: rows.note })
    : unscorableExtraction(rows.why, rows.shapes);
  // Everything the app handed back on the way to the model. The harness cannot read
  // the prompt the host builds, so this is what a leak is scored against.
  const seen = {
    figuresText: imported.figuresText,
    "import proseText": imported.proseText ?? "",
    "report prose": view.prose,
    "sheets[].preview": imported.previews ?? "",
  };
  const scores = scoreEverything(kase, extraction, view, parsed.parsed, seen, exported);
  const verdict = verdictForScoredCase(casePasses(scores));
  return {
    id: kase.id,
    task: kase.task,
    locale: kase.locale,
    status: verdict.status,
    reasons: verdict.reasons,
    stages: {
      import: {
        ok: imported.ok,
        ms: imported.ms,
        sheets: imported.sheets,
        skipped: imported.skipped,
        error: imported.error,
      },
      parse: { ok: true, ms: parsed.ms, shapes: rows.shapes, via: rows.via, note: rows.note ?? null },
      generate: { ok: true, ms: generated.ms, phases: generated.phases, resultKind: view.reportFrom },
      export: {
        ok: exported.ok,
        files: exported.files,
        summary: exported.summary,
        calc: exported.calc,
        deck: exported.deck,
      },
    },
    figuresText: imported.figuresText,
    parsed: parsed.parsed,
    extractionRows: rows.rows,
    report: view.report,
    brief: generated.result?.brief ?? null,
    markdown: generated.result?.markdown ?? "",
    guard: generated.result?.guard ?? null,
    notice: generated.result?.notice ?? null,
    scores,
  };
}

/**
 * Run one case and score it, once.
 *
 * Throws nothing: a stage that stopped comes back as a status and the app's own
 * message, and a harness bug comes back as ERROR with the stack's first line.
 */
export async function runCase(ctx, kase) {
  const started = performance.now();
  try {
    const result = await driveCase(ctx, kase);
    return { ...result, totalMs: Math.round(performance.now() - started) };
  } catch (error) {
    const stopped =
      error instanceof StageStopped
        ? verdictForStoppedCase(error.stage, error.appError)
        : verdictForStoppedCase("harness", describe(error));
    return {
      id: kase.id,
      task: kase.task,
      locale: kase.locale,
      ...stopped,
      totalMs: Math.round(performance.now() - started),
    };
  }
}

/**
 * The same case, once more, when the first attempt died on a transient gateway
 * failure and the run was invoked with `--retry-transient`. Off by default: a
 * silent retry turns a flaky gateway into a number nobody can reproduce.
 */
export async function runCaseWithRetry(ctx, kase, { retryTransient = false } = {}) {
  const first = await runCase(ctx, kase);
  if (!retryTransient || first.retryable !== true) {
    return first;
  }
  const second = await runCase(ctx, kase);
  return {
    ...second,
    retried: { attempted: true, firstStatus: first.status, firstError: first.error ?? null },
    totalMs: first.totalMs + second.totalMs,
  };
}
