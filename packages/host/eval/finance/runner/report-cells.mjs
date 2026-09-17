/**
 * Every number the finished report puts in front of a reader, flattened into one
 * comparable list.
 *
 * A `FinanceReport` says the same figure in up to four places — a summary KPI, a
 * table cell, a point on a chart series, a sentence in a note — and which one it
 * lands in is the task's choice, not the reader's. So the figure scorer asks the
 * whole report rather than one preferred corner of it, and every cell carries the
 * words around it (its row's name, its column's header, its table's title) so that
 * "which metric is this?" can be answered when two cells happen to share a value.
 *
 * Pure. Takes the report, gives cells.
 */
import { normaliseLabel } from "./labels.mjs";

/** Words too short to identify anything. Kept out of the token sets on both sides. */
const MIN_TOKEN = 3;

export function tokensOf(...parts) {
  const words = parts
    .filter((part) => part !== null && part !== undefined)
    .flatMap((part) => normaliseLabel(String(part)).split(" "));
  return [...new Set(words.filter((word) => word.length >= MIN_TOKEN))];
}

/** A unit word the report itself states, mapped onto the kinds a truth figure declares. */
const UNIT_WORD = [
  [/^(%|percent|persen|pct)$/i, "percent"],
  [/^(x|kali|times|ratio|rasio)$/i, "ratio"],
  [/^(months?|bulan)$/i, "months"],
  [/^(years?|tahun)$/i, "years"],
  [/^(idr|usd|eur|sgd|gbp|jpy|rp|\$)$/i, "currency"],
];

/**
 * The unit a KPI declares. `unknown` is a real answer and is deliberately not
 * "number": a cell that names no unit cannot contradict one, and pretending it
 * said "number" would fail a correct percentage for being in a spreadsheet.
 */
export function unitOfLabel(unit) {
  const raw = String(unit ?? "").trim();
  if (raw === "") {
    return "unknown";
  }
  const hit = UNIT_WORD.find(([pattern]) => pattern.test(raw));
  return hit ? hit[1] : "currency";
}

/**
 * The unit a column DECLARES — and only a declaration counts.
 *
 * This reads the column header alone, and only an explicit marker in it: a
 * trailing `%`, a parenthesised `(x)` / `(bulan)` / `(IDR)`, or a header that IS
 * the unit word. Sniffing the surrounding prose reads a table titled "Arus kas per
 * tahun" — cash flow *per year* — as a table of durations, and then refuses every
 * currency figure in it. A column that names no unit answers `unknown`, which
 * contradicts nothing.
 */
export function unitOfColumn(header) {
  const raw = String(header ?? "").trim();
  if (raw === "") {
    return "unknown";
  }
  if (/%\s*\)?$|\(\s*%\s*\)|\bpersen\b|\bpercent\b/i.test(raw)) {
    return "percent";
  }
  const bracketed = /\(([^()]{1,12})\)\s*$/.exec(raw)?.[1]?.trim() ?? "";
  const candidate = bracketed || raw;
  const hit = UNIT_WORD.find(([pattern]) => pattern.test(candidate));
  if (hit) {
    return hit[1];
  }
  return /^x$/i.test(candidate) ? "ratio" : "unknown";
}

/** A truth unit against a cell's. `unknown` on the cell side never blocks a match. */
export function cellUnitAllows(truthUnit, cellUnit, unitsCompatible) {
  return cellUnit === "unknown" ? true : unitsCompatible(truthUnit, cellUnit);
}

function kpiCells(report) {
  return (report?.summary ?? [])
    .filter((kpi) => typeof kpi.value === "number" && Number.isFinite(kpi.value))
    .map((kpi) => ({
      value: kpi.value,
      unit: unitOfLabel(kpi.unit),
      tokens: tokensOf(kpi.label, kpi.unit),
      ownTokens: tokensOf(kpi.label),
      period: "",
      where: "summary",
      name: kpi.label,
    }));
}

/** The brief's own computed metrics, which carry an explicit key and period. */
function metricCells(view) {
  return (view?.metrics ?? [])
    .filter((metric) => Number.isFinite(metric?.value))
    .map((metric) => ({
      value: metric.value,
      unit: unitOfLabel(metric.unit),
      tokens: tokensOf(metric.label, metric.key, metric.period),
      ownTokens: tokensOf(metric.label, metric.period),
      period: metric.period ?? "",
      where: "metric",
      name: metric.label ?? metric.key,
    }));
}

/** The leading text cells of a row are its name; the column header is its period. */
function rowLabel(row) {
  const leading = [];
  for (const cell of row) {
    if (typeof cell !== "string") {
      break;
    }
    leading.push(cell);
  }
  return leading.join(" ");
}

function tableCells(report) {
  return (report?.tables ?? []).flatMap((table) => {
    const columns = table.columns ?? [];
    return (table.rows ?? []).flatMap((row) => {
      const name = rowLabel(row);
      return row.flatMap((cell, index) =>
        typeof cell === "number" && Number.isFinite(cell)
          ? [
              {
                value: cell,
                unit: unitOfColumn(columns[index]),
                tokens: tokensOf(name, columns[index], table.title),
                ownTokens: tokensOf(name, columns[index]),
                period: String(columns[index] ?? ""),
                where: `table:${table.id || table.title}`,
                name: `${name} · ${columns[index] ?? ""}`.trim(),
              },
            ]
          : [],
      );
    });
  });
}

function chartCells(report) {
  return (report?.charts ?? []).flatMap((chart) =>
    (chart.series ?? []).flatMap((series) =>
      (series.values ?? []).flatMap((value, index) =>
        typeof value === "number" && Number.isFinite(value)
          ? [
              {
                value,
                unit: unitOfColumn(series.name),
                tokens: tokensOf(series.name, chart.title, chart.categories?.[index]),
                ownTokens: tokensOf(series.name, chart.categories?.[index]),
                period: String(chart.categories?.[index] ?? ""),
                where: `chart:${chart.id || chart.title}`,
                name: `${chart.title} · ${series.name}`,
              },
            ]
          : [],
      ),
    ),
  );
}

/**
 * Every structured number in the report, with its words. KPIs first, then the
 * brief's metrics, then tables, then charts — the order a reader would look in,
 * and the order the trace names a hit in when several cells share a value.
 */
export function reportCells(view) {
  const report = view?.report ?? null;
  return [...kpiCells(report), ...metricCells(view), ...tableCells(report), ...chartCells(report)];
}

/**
 * The number culture to read the app's own words in.
 *
 * Not the case's. A report states `-151.000`, and whether that is minus one
 * hundred and fifty-one or minus a hundred and fifty-one thousand is decided by
 * the language the REPORT was written in. The host writes a task's report in the
 * locale the process is running in, so an `en` case can legitimately come back in
 * Indonesian — and reading it as English turns every figure in it into an
 * invention. The report says which it is; the case is only the fallback.
 */
export function localeOfReport(view, fallback = "en") {
  const stated = view?.report?.locale;
  return stated === "id" || stated === "en" ? stated : fallback === "id" ? "id" : "en";
}

/** The prose a report carries: its notes, its flags, and a brief's own sections. */
export function reportProse(view) {
  const report = view?.report ?? null;
  return [
    view?.narrative ?? "",
    ...(report?.notes ?? []).map((note) => `${note.heading}\n\n${note.body}`),
    ...(report?.flags ?? []).map((flag) => flag.text),
  ]
    .filter((part) => String(part).trim() !== "")
    .join("\n\n");
}
