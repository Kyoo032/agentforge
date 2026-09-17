/**
 * The one page the owner reads: a row per case, a roll-up per task, and a verdict
 * line that says how many REAL cases pass.
 *
 * Two things it refuses to do. It never prints a score beside a case that did not
 * run — a blocked or transient case shows `-` in every score column, because a
 * number there would be a claim about an app that never answered. And it never
 * folds the runner's own two fixtures into the headline: they exist to prove the
 * harness works, and counting them would flatter every run by two.
 */
import { CASE_STATUS, SCORED_STATUSES } from "./verdict.mjs";
import {
  PASS_BUDGET_FLAGGED_F1,
  PASS_BUDGET_PAIR_F1,
  PASS_EXTRACTION_F1,
  PASS_FIGURE_ACCURACY,
  PASS_MAX_HALLUCINATED,
  PASS_MAX_WRONG_RATE,
} from "./scoring.mjs";

const COLUMNS = ["case", "task", "extraction F1", "figure acc", "wrong", "halluc", "export ok", "PASS/FAIL"];
/**
 * Budget cases answer two questions nothing else does — which two lines were
 * paired, and which lines were flagged — so they get their own table rather than
 * two mostly empty columns on everyone else's.
 */
const BUDGET_COLUMNS = ["case", "pair F1", "pairs matched", "flagged F1", "flagged missed"];
/** How many missed truth keys a failing case lists. More than this is a report, not a summary. */
export const TOP_MISSES = 5;

function num(value) {
  return Number.isFinite(value) ? value.toFixed(3) : "-";
}

function exportCell(result) {
  const stage = result.stages?.export;
  const files = stage?.files ?? [];
  if (files.length === 0) {
    return "-";
  }
  const parts = files.map((file) => `${file.format}${file.ok ? " ok" : " FAIL"}`);
  if (stage.summary && stage.summary.missing.length > 0) {
    parts.push(`summary -${stage.summary.missing.length}`);
  }
  if (stage.calc && (stage.calc.mismatches.length > 0 || stage.calc.uncached.length > 0)) {
    parts.push(`calc ${stage.calc.mismatches.length} off / ${stage.calc.uncached.length} uncached`);
  }
  if (stage.deck && !stage.deck.ok) {
    parts.push(`charts ${stage.deck.charts}/${stage.deck.expected}`);
  }
  return parts.join(", ");
}

function row(result) {
  const scores = SCORED_STATUSES.has(result.status) ? result.scores : null;
  if (!scores) {
    return [result.id, result.task ?? "-", "-", "-", "-", "-", "-", result.status];
  }
  return [
    result.id,
    result.task ?? "-",
    scores.extraction.scorable === false ? "n/a" : num(scores.extraction.f1),
    num(scores.figures.accuracy),
    num(scores.figures.wrongRate),
    String(scores.hallucination.count),
    exportCell(result),
    result.status,
  ];
}

function table(results) {
  const lines = [`| ${COLUMNS.join(" | ")} |`, `| ${COLUMNS.map(() => "---").join(" | ")} |`];
  for (const result of results) {
    lines.push(`| ${row(result).join(" | ")} |`);
  }
  return lines.join("\n");
}

function counts(results) {
  const counted = results.filter((result) => SCORED_STATUSES.has(result.status));
  return {
    counted: counted.length,
    passed: counted.filter((result) => result.status === CASE_STATUS.pass).length,
    blocked: results.filter((result) => result.status === CASE_STATUS.blocked).length,
    transient: results.filter((result) => result.status === CASE_STATUS.transient).length,
    skipped: results.filter((result) => result.status === CASE_STATUS.skipped).length,
    unsupported: results.filter((result) => result.status === CASE_STATUS.unsupportedInput).length,
    errored: results.filter((result) => result.status === CASE_STATUS.error).length,
  };
}

/** The pairing and the flagged set, for the cases that have one. */
function budgetTable(results) {
  const rows = results.filter((result) => SCORED_STATUSES.has(result.status) && result.scores?.budget);
  if (rows.length === 0) {
    return "";
  }
  const lines = [`| ${BUDGET_COLUMNS.join(" | ")} |`, `| ${BUDGET_COLUMNS.map(() => "---").join(" | ")} |`];
  for (const result of rows) {
    const pairs = result.scores.budget;
    const flags = result.scores.budgetFlags;
    lines.push(
      `| ${result.id} | ${num(pairs.f1)} | ${pairs.matched}/${pairs.truthTotal} | ${flags ? num(flags.f1) : "-"} | ${flags ? flags.missed.slice(0, 3).join(", ") || "none" : "-"} |`,
    );
  }
  return `## Budget pairing and flags\n\nPass bars: pair F1 >= ${PASS_BUDGET_PAIR_F1}, flagged-set F1 >= ${PASS_BUDGET_FLAGGED_F1}.\n\n${lines.join("\n")}\n`;
}

/** One line per task: how many of its cases ran, and how many of those passed. */
function taskRollup(results) {
  const byTask = new Map();
  for (const result of results) {
    const task = result.task ?? "unknown";
    byTask.set(task, [...(byTask.get(task) ?? []), result]);
  }
  const lines = [
    "| task | cases | scored | pass | blocked | transient | skipped | error |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const [task, rows] of [...byTask.entries()].sort()) {
    const tally = counts(rows);
    lines.push(
      `| ${task} | ${rows.length} | ${tally.counted} | ${tally.passed} | ${tally.blocked} | ${tally.transient} | ${tally.skipped} | ${tally.errored} |`,
    );
  }
  return `## Per task\n\n${lines.join("\n")}\n`;
}

function verdict(results) {
  const real = results.filter((result) => result.fixture !== true);
  const all = counts(results);
  const realTally = counts(real);
  const rate = realTally.counted === 0 ? 0 : (realTally.passed / realTally.counted) * 100;
  const headline =
    realTally.counted === 0
      ? real.length === 0
        ? "**Verdict:** no real case ran — this was a fixtures-only run."
        : "**Verdict:** no real case was scorable."
      : `**Verdict:** ${realTally.passed}/${realTally.counted} real cases pass (fixtures excluded, ${rate.toFixed(1)} %).`;
  return [
    headline,
    `Across all ${results.length} case(s): ${all.passed} pass, ${all.counted - all.passed} fail, ` +
      `${all.blocked} blocked with no live model, ${all.transient} stopped on a transient gateway error, ` +
      `${all.unsupported} blocked on an input type the import route refuses, ${all.skipped} task not built yet, ` +
      `${all.errored} harness error(s).`,
  ].join("\n");
}

/** Stages that answered, but not through the app. Worth knowing before reading a score. */
function fallbackNotes(results) {
  const lines = results
    .filter((result) => result.stages?.import && result.stages.import.ok === false)
    .map(
      (result) =>
        `- \`${result.id}\` — the import route answered ${result.stages.import.error?.status ?? "?"}, so the figures were read with core's own \`readFinanceTable\` in-process.`,
    );
  return lines.length === 0 ? "" : `\n## Stages that did not go through the app\n\n${lines.join("\n")}\n`;
}

/** Cases the run tried twice. Never silent: a retried number is a different number. */
function retryNotes(results) {
  const lines = results
    .filter((result) => result.retried?.attempted)
    .map(
      (result) =>
        `- \`${result.id}\` — first attempt ${result.retried.firstStatus} (${result.retried.firstError?.message ?? "no message"}); re-run once because \`--retry-transient\` was passed, and the row above is the SECOND attempt.`,
    );
  return lines.length === 0 ? "" : `\n## Retried\n\n${lines.join("\n")}\n`;
}

/** The truth keys a failing case did not get: the shortest useful list of what to fix. */
export function topMisses(result, limit = TOP_MISSES) {
  const scores = result.scores;
  if (!scores) {
    return [];
  }
  const figures = (scores.figures?.figures ?? [])
    .filter((figure) => figure.verdict === "WRONG" || figure.verdict === "MISSING")
    .map(
      (figure) =>
        `${figure.key ?? figure.label} (${figure.verdict}${figure.stated === null ? "" : `, report said ${figure.stated}`})`,
    );
  const rows = (scores.extraction?.misses ?? []).map((miss) =>
    `row "${miss.label}" ${miss.period ?? ""} (${miss.reason})`.trim(),
  );
  return [...figures, ...rows].slice(0, limit);
}

/** Why a case failed, in the order a fix wave should read it. */
function failureNotes(results) {
  const lines = [];
  for (const result of results) {
    if (result.status === CASE_STATUS.pass) {
      continue;
    }
    const why = result.error
      ? `${result.error.code}${result.error.status ? ` ${result.error.status}` : ""} at the ${result.stoppedAt ?? result.error.stage} stage: ${result.error.message}`
      : (result.reasons ?? []).join("; ") || "no reason recorded";
    lines.push(`- \`${result.id}\` (${result.status}) — ${why}`);
    for (const miss of topMisses(result)) {
      lines.push(`    - missed: ${miss}`);
    }
  }
  return lines.length === 0 ? "" : `\n## Why\n\n${lines.join("\n")}\n`;
}

/** The header, with the two runtime fields told apart rather than run together. */
export function runtimeLine(runtime) {
  return [
    `Runtime: model calls ${runtime.runtime === "ai" ? "go out for real" : "are stubbed"}`,
    `key ${runtime.keyPresent ? `saved (${runtime.providersWithKey.join(", ")})` : "absent"}`,
    `gate \`${runtime.gatewayStatus}\` allowed=${runtime.gatewayAllowed} — ${runtime.gatewayMeaning ?? "meaning not reported"}`,
    `${runtime.chatModelCount} chat models`,
    `app locale \`${runtime.locale}\``,
  ].join(" · ");
}

export function summaryMarkdown(run) {
  const rule =
    `extraction F1 >= ${PASS_EXTRACTION_F1}, figure accuracy >= ${PASS_FIGURE_ACCURACY}, wrongRate <= ${PASS_MAX_WRONG_RATE}, ` +
    `hallucinated figures <= ${PASS_MAX_HALLUCINATED}, no figure the case calls undefined given a number, no forbidden text, ` +
    `no planted personal value in anything the app handed back` +
    `; for a budget case also pair F1 >= ${PASS_BUDGET_PAIR_F1} and flagged-set F1 >= ${PASS_BUDGET_FLAGGED_F1}.`;
  return [
    `# Finance accuracy run — ${run.startedAt}`,
    "",
    `Base: ${run.base} · model: ${run.model ?? "app default"} · cases: ${run.results.length}` +
      (run.taskFilter ? ` · task filter: \`${run.taskFilter}\`` : "") +
      (run.retryTransient ? " · `--retry-transient` on" : ""),
    runtimeLine(run.runtime),
    "",
    `Pass rule: ${rule}`,
    "",
    table(run.results),
    "",
    verdict(run.results),
    "",
    taskRollup(run.results),
    budgetTable(run.results),
    fallbackNotes(run.results),
    retryNotes(run.results),
    failureNotes(run.results),
  ].join("\n");
}
