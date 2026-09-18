/**
 * One flat view of whatever the app answered with, so the scorer never has to know
 * the difference between a brief and a task's report.
 *
 * There are two shapes on the wire and they are not interchangeable. The brief
 * answers with a `FinanceBrief`, which the export route turns into a
 * `FinanceReport` with the product's own `financeReportFromBrief` — so the harness
 * calls exactly that, and asks its questions of the object the owner receives as a
 * file. Every other task answers with the `FinanceReport` itself, already built by
 * the task module, and that one is read as it stands: re-deriving it would be the
 * harness scoring its own arithmetic.
 */
import { financeReportFromBrief, scanPii } from "./ts-bridge.mjs";
import { FULL_PERIOD_KEY, normaliseLabel } from "./labels.mjs";
import { extractFigures } from "./numbers.mjs";
import { reportProse } from "./report-cells.mjs";

/**
 * Columns a budget table may name its two sides with, in either language. These three
 * stay unanchored because a money column declares its currency beside its name —
 * `Selisih (IDR)`, `Variance (USD)`.
 */
const PLANNED_COLUMN = /(plan|planned|budget|anggaran|rencana)/i;
const ACTUAL_COLUMN = /(actual|aktual|realisasi|realized)/i;
const VARIANCE_COLUMN = /(variance|varians|selisih)/i;
/**
 * The columns that carry a role rather than the line's own name. Anchored, because
 * only a header that IS the role word plays it: `Baris ditandai` is a count of
 * flagged lines, not a flag column, and reading it as one would leave the counts
 * table looking like a list of names.
 */
const PERIOD_COLUMN = /^(period|periode)$/i;
const PARTNER_COLUMN = /^(partner|pasangan)$/i;
const DIRECTION_COLUMN = /^(direction|arah)$/i;
const FLAG_COLUMN = /^(flag|tanda)$/i;
const MATCH_COLUMN = /^(match|kecocokan)$/i;
const READING_COLUMN = /^(reading|bacaan)$/i;
const ROLE_COLUMNS = [
  PLANNED_COLUMN,
  ACTUAL_COLUMN,
  VARIANCE_COLUMN,
  PERIOD_COLUMN,
  PARTNER_COLUMN,
  DIRECTION_COLUMN,
  FLAG_COLUMN,
  MATCH_COLUMN,
  READING_COLUMN,
];
/** A table that NAMES the flagged lines — or, in the counts table's case, only counts them. */
const FLAG_TABLE = /flag|tanda|ditandai/i;
/** `Sewa kantor: -207.500.000 (-11,2 %) — tidak menguntungkan`, as a flag sentence reads. */
const FLAG_SENTENCE = /^\s*([^:]{1,120}):\s+\S/;

function sectionsText(brief) {
  return (brief?.sections ?? []).map((section) => `${section.heading}\n\n${section.body}`).join("\n\n");
}

function briefTables(brief) {
  const fromSections = (brief?.sections ?? []).flatMap((section) => section.tables ?? []);
  const computed = brief?.computed?.tables ?? [];
  return [...computed, ...fromSections].map((table) => ({
    id: table.id ?? table.name ?? "",
    title: table.title ?? table.name ?? "",
    columns: table.columns ?? [],
    rows: table.rows ?? [],
  }));
}

/**
 * The report this result carries. A task's own report wins; a brief is rendered
 * through the product's own converter; anything else is null and the caller says
 * so rather than scoring an empty object.
 */
export function reportOf(result, options = {}) {
  if (result?.report && typeof result.report === "object") {
    return { report: result.report, from: "task" };
  }
  if (result?.brief) {
    return {
      report: financeReportFromBrief(result.brief, { task: options.task, locale: options.locale }),
      from: "brief",
    };
  }
  return { report: null, from: "none" };
}

/**
 * Everything the scorer reads.
 *
 * `narrative` is the prose only — a brief's headings and bodies, a task report's
 * notes and flags. A figure that reaches the reader through a table is
 * FOUND_STRUCTURED, not FOUND_PROSE, and mixing the two would hide exactly that
 * difference.
 */
export function scorableReport(result, options = {}) {
  const brief = result?.brief ?? null;
  const { report, from } = reportOf(result, options);
  const narrative = sectionsText(brief);
  const view = {
    reportFrom: from,
    narrative,
    assumptions: brief?.assumptions ?? [],
    metrics: brief?.computed?.metrics ?? [],
    kpis: report?.summary ?? [],
    tables: [...(report?.tables ?? []), ...briefTables(brief)],
    charts: report?.charts ?? [],
    flags: report?.flags ?? [],
    notes: report?.notes ?? [],
    markdown: result?.markdown ?? "",
    report,
  };
  const prose = reportProse(view);
  return {
    ...view,
    prose,
    /** Everything a `mustMention` / `mustNotContain` check should look at. */
    text: [brief?.title ?? "", report?.title ?? "", report?.subtitle ?? "", prose, ...(brief?.assumptions ?? [])]
      .filter((part) => String(part).trim() !== "")
      .join("\n"),
  };
}

/**
 * A parameter the owner typed. A scenario axis arrives as an array of numbers
 * (`rateScenarios: [10, 12, 14]`), and every one of those is a figure the owner
 * put there — the product's own guard treats them the same way, so the harness
 * must too or it will call the app's own inputs inventions.
 */
function typedNumbers(params) {
  return Object.values(params ?? {}).flatMap((value) => {
    if (typeof value === "number") {
      return [value];
    }
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "number") : [];
  });
}

/**
 * A report states numbers in its words too: a sensitivity grid's axis is the
 * string "10%", not the number 10. Those are displayed figures, not invented ones.
 */
function numbersInReportText(view, locale) {
  const strings = (view.tables ?? []).flatMap((table) => [
    ...(table.columns ?? []),
    ...(table.rows ?? []).flatMap((row) => row.filter((cell) => typeof cell === "string")),
  ]);
  const labels = [
    ...(view.kpis ?? []).flatMap((kpi) => [kpi.label, typeof kpi.value === "string" ? kpi.value : ""]),
    ...(view.charts ?? []).flatMap((chart) => chart.categories ?? []),
  ];
  return [...strings, ...labels]
    .filter((text) => typeof text === "string" && /\d/.test(text))
    .flatMap((text) => extractFigures(text, locale).map((figure) => figure.value));
}

/**
 * Every number the report is allowed to state: the rows the owner confirmed, the
 * metrics computed from them, everything the report itself displays, the case's
 * own truth, and the parameters typed in. Anything else in the prose is a number
 * the app invented.
 */
export function allowedNumbers(parsedItems, view, truth, params, options = {}) {
  // Read in the language the report was written in, not the one the case asked for.
  const locale = options.locale === "id" ? "id" : "en";
  const items = (parsedItems ?? []).map((item) => item.amount);
  const truthItems = (truth?.lineItems ?? []).map((item) => item.amount);
  const truthFigures = (truth?.figures ?? []).map((figure) => figure.value);
  const metrics = (view.metrics ?? []).map((metric) => metric.value);
  const kpis = (view.kpis ?? []).map((kpi) => kpi.value);
  const tables = (view.tables ?? []).flatMap((table) =>
    (table.rows ?? []).flatMap((row) => row.filter((cell) => typeof cell === "number")),
  );
  const charts = (view.charts ?? []).flatMap((chart) =>
    (chart.series ?? []).flatMap((series) => (series.values ?? []).filter((value) => typeof value === "number")),
  );
  return [
    ...items,
    ...truthItems,
    ...truthFigures,
    ...metrics,
    ...kpis,
    ...tables,
    ...charts,
    ...typedNumbers(params),
    ...numbersInReportText(view, locale),
  ].filter((value) => Number.isFinite(value));
}

function columnIndex(columns, pattern) {
  return columns.findIndex((column) => pattern.test(String(column ?? "")));
}

/** The first column that plays no other role. That one is the line's own name. */
function labelColumnIndex(columns) {
  return columns.findIndex((column) => !ROLE_COLUMNS.some((pattern) => pattern.test(String(column ?? ""))));
}

/** Where a budget-ish table keeps each of its parts, or null when it is not one. */
function pairColumnsOf(table) {
  const columns = table.columns ?? [];
  const at = {
    label: labelColumnIndex(columns),
    planned: columnIndex(columns, PLANNED_COLUMN),
    actual: columnIndex(columns, ACTUAL_COLUMN),
    variance: columnIndex(columns, VARIANCE_COLUMN),
    partner: columnIndex(columns, PARTNER_COLUMN),
    period: columnIndex(columns, PERIOD_COLUMN),
  };
  return at.label === -1 || at.planned === -1 || at.actual === -1 ? null : at;
}

/**
 * One pair the report proposed.
 *
 * The partner column is the ACTUAL side's own name — the line this variance was
 * taken against — and an empty cell is a line that found no partner at all, which is
 * exactly what a case writing `actualLabel: null` asks about. Reading the row's own
 * name into both sides, as this used to, made every pair agree with itself: a report
 * that compared a line against the wrong sheet row could never be scored as one.
 */
function pairFromRow(row, at) {
  const name = String(row[at.label] ?? "");
  // A table with no partner column states nothing about pairing; the row's own name
  // is the only thing it says, and a case that asks about partners gets that answer.
  const partner = at.partner === -1 ? name : String(row[at.partner] ?? "").trim();
  return {
    label: name,
    budgetLabel: name,
    actualLabel: partner === "" ? null : partner,
    planned: typeof row[at.planned] === "number" ? row[at.planned] : Number.NaN,
    actual: typeof row[at.actual] === "number" ? row[at.actual] : Number.NaN,
    variance: at.variance === -1 || typeof row[at.variance] !== "number" ? undefined : row[at.variance],
  };
}

/** Planned-versus-actual rows, from the table that says the most about the pairing. */
export function budgetPairsFrom(view) {
  const candidates = (view.tables ?? [])
    .map((table) => ({ table, at: pairColumnsOf(table) }))
    .filter((entry) => entry.at !== null && entry.at.period === -1);
  const chosen = candidates.find((entry) => entry.at.partner !== -1) ?? candidates[0];
  if (!chosen) {
    return [];
  }
  return (chosen.table.rows ?? [])
    .filter((row) => typeof row[chosen.at.planned] === "number" || typeof row[chosen.at.actual] === "number")
    .map((row) => pairFromRow(row, chosen.at));
}

/** One row of the flagged-line table: which line, under the period it broke in. */
function flaggedTableLines(table, at) {
  return (table.rows ?? [])
    .map((row) => ({
      period: at.period === -1 ? FULL_PERIOD_KEY : String(row[at.period] ?? ""),
      label: String(row[at.label] ?? "").trim(),
    }))
    .filter((line) => line.label !== "");
}

/** A report that tables nothing still names its flagged lines in its own sentences. */
function flaggedSentenceLines(view) {
  return (view.flags ?? [])
    .flatMap((flag) => FLAG_SENTENCE.exec(String(flag?.text ?? ""))?.[1] ?? [])
    .map((label) => ({ period: FULL_PERIOD_KEY, label: label.trim() }));
}

/**
 * The lines the report itself flagged, each under the period it broke in.
 *
 * Only the table that NAMES them is read. The counts table beside it says how many,
 * which is a different sentence — and it is told apart by having no budget and no
 * actual to show, not by its title, which says "flagged" just as loudly.
 */
export function flaggedLinesFrom(view) {
  for (const table of view.tables ?? []) {
    const at = pairColumnsOf(table);
    if (at && FLAG_TABLE.test(`${table.id} ${table.title}`)) {
      return flaggedTableLines(table, at);
    }
  }
  return flaggedSentenceLines(view);
}

/** Personal data that reached the finished report, using the product's own scanner. */
export function piiFrom(view) {
  return scanPii(view.text ?? "");
}

/** Truth figures the workbook must also carry, checked against the numbers read back out of it. */
export function workbookCoverage(truthFigures, workbook, matches) {
  if (!workbook) {
    // No workbook came back at all; "0 % of figures found" would read as a
    // wrong export rather than an absent one.
    return {
      available: false,
      total: (truthFigures ?? []).length,
      found: 0,
      accuracy: null,
      missing: [],
      sheetNames: [],
      formulaCount: 0,
    };
  }
  const values = (workbook?.sheets ?? []).flatMap((sheet) => sheet.values);
  const scored = (truthFigures ?? [])
    .filter((figure) => figure.value !== null)
    .map((figure) => ({
      key: figure.key,
      label: figure.label,
      expected: figure.value,
      inWorkbook: values.some((value) => matches(figure.value, value, figure.tolerance)),
    }));
  const found = scored.filter((entry) => entry.inWorkbook).length;
  return {
    available: true,
    total: scored.length,
    found,
    accuracy: scored.length === 0 ? 1 : found / scored.length,
    missing: scored.filter((entry) => !entry.inWorkbook).map((entry) => entry.key ?? entry.label),
    sheetNames: workbook?.sheetNames ?? [],
    formulaCount: (workbook?.sheets ?? []).reduce((sum, sheet) => sum + sheet.formulas.length, 0),
  };
}

/** A label is only ever compared normalised; exported so the summary prints the same spelling. */
export { normaliseLabel };
