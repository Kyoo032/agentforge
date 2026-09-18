/**
 * What a register of rows actually says, computed in code.
 *
 * A payroll, a fee schedule or a per-outlet sales list is not a statement: there is no revenue and no
 * margin to compute, and the profit ladder answers `null` for every rung. What a reader of one wants
 * is the shape of the list — how many rows, what they add up to, what the typical row is, which row
 * is highest and lowest, and how the parts of each row relate — and every one of those is arithmetic,
 * so none of it is ever asked of a model.
 *
 * The one rule that keeps the numbers honest: **columns are never added to each other.** `gaji pokok`,
 * `tunjangan` and `potongan` are three views of the SAME payment that `gaji bersih` settles, so adding
 * them would report a payroll at twice its size. Only a column the sheet marked as a separate payment
 * — a reimbursement paid on top — joins the bottom line, and only in the one figure that says so.
 */
import type { NamedTable } from "../artifacts/data-analysis";
import { suffixed } from "./period-metrics";
import type { ReportLocale } from "./report";
import type { LineItem, Metric, RegisterCell } from "./types";

/** How many of a register's rows a column must settle before it is the register's bottom line. */
const NET_MATCH_SHARE = 0.8;

/** The middle value, or the mean of the two middle ones — a figure no single row need hold. */
export function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const at = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return Number.NaN;
  }
  return sorted.length % 2 === 1 ? (sorted[at] as number) : ((sorted[at - 1] as number) + (sorted[at] as number)) / 2;
}

export type RegisterColumnStats = {
  readonly label: string;
  /** A separate payment beside the bottom line, rather than a part of it. */
  readonly extra: boolean;
  /** This is the column the row settles on. */
  readonly net: boolean;
  readonly total: number;
  readonly count: number;
  readonly average: number;
  readonly median: number;
  readonly min: number;
  readonly max: number;
};

export type RegisterReading = {
  readonly rows: readonly LineItem[];
  readonly period: string;
  /** What the rows are each one of, taken from their own labels: "Karyawan 1" → "Karyawan". */
  readonly entity: string;
  readonly columns: readonly RegisterColumnStats[];
  /** The biggest component column: what the other components are naturally read against. */
  readonly base: RegisterColumnStats | null;
  readonly net: RegisterColumnStats | null;
  /** Everything that actually left the account: the bottom line plus the payments beside it. */
  readonly payout: number | null;
};

function cellsOf(rows: readonly LineItem[], label: string): RegisterCell[] {
  return rows.flatMap((row) => (row.columns ?? []).filter((cell) => cell.label === label));
}

/** Column labels in the order the sheet wrote them, each one once. */
function columnLabels(rows: readonly LineItem[]): string[] {
  const seen: string[] = [];
  for (const cell of rows.flatMap((row) => row.columns ?? [])) {
    if (!seen.includes(cell.label)) {
      seen.push(cell.label);
    }
  }
  return seen;
}

/** The column whose value IS the row's amount on nearly every row: the bottom line the sheet chose. */
function netLabelOf(rows: readonly LineItem[], labels: readonly string[]): string {
  const settled = labels.filter((label) => {
    const hits = rows.filter((row) => (row.columns ?? []).some((cell) => cell.label === label && cell.amount === row.amount));
    return rows.length > 0 && hits.length / rows.length >= NET_MATCH_SHARE;
  });
  return settled.at(-1) ?? "";
}

function statsFor(rows: readonly LineItem[], label: string, netLabel: string): RegisterColumnStats | null {
  const cells = cellsOf(rows, label);
  const amounts = cells.map((cell) => cell.amount);
  if (amounts.length === 0) {
    return null;
  }
  const total = amounts.reduce((sum, value) => sum + value, 0);
  return {
    label,
    extra: cells.some((cell) => cell.extra === true),
    net: label === netLabel,
    total,
    count: amounts.length,
    average: total / amounts.length,
    median: median(amounts),
    min: Math.min(...amounts),
    max: Math.max(...amounts),
  };
}

/** The words every row's label opens with — "Karyawan 1".."Karyawan 8" are each one Karyawan. */
export function commonLabelPrefix(labels: readonly string[]): string {
  const split = labels.map((label) => label.trim().split(/\s+/));
  const first = split[0];
  if (!first || split.length < 2) {
    return "";
  }
  const shared: string[] = [];
  for (const [at, word] of first.entries()) {
    if (!split.every((words) => (words[at] ?? "").toLowerCase() === word.toLowerCase())) {
      break;
    }
    shared.push(word);
  }
  return shared.join(" ");
}

/**
 * The register a confirmed list holds, or `null` when the rows carry no columns — which is every
 * statement, every ledger and every pasted list, so nothing outside a register sheet changes.
 */
export function readRegister(items: readonly LineItem[]): RegisterReading | null {
  const rows = items.filter((item) => (item.columns ?? []).length > 0);
  const labels = columnLabels(rows);
  if (rows.length < 2 || labels.length === 0) {
    return null;
  }
  const netLabel = netLabelOf(rows, labels);
  const columns = labels.flatMap((label) => {
    const stats = statsFor(rows, label, netLabel);
    return stats ? [stats] : [];
  });
  const components = columns.filter((column) => !column.net && !column.extra);
  const base = [...components].sort((left, right) => Math.abs(right.total) - Math.abs(left.total))[0] ?? null;
  const net = columns.find((column) => column.net) ?? null;
  const extras = columns.filter((column) => column.extra);
  return {
    rows,
    period: rows[0]?.period ?? "",
    entity: commonLabelPrefix(rows.map((row) => row.label)),
    columns,
    base,
    net,
    payout: net === null ? null : net.total + extras.reduce((sum, column) => sum + column.total, 0),
  };
}

type Words = Record<ReportLocale, string>;

const WORDS = {
  count: { en: "Number of", id: "Jumlah" },
  rows: { en: "rows", id: "baris" },
  total: { en: "Total", id: "Total" },
  average: { en: "Average", id: "Rata-rata" },
  median: { en: "Median", id: "Median" },
  highest: { en: "Highest", id: "tertinggi" },
  lowest: { en: "Lowest", id: "terendah" },
  against: { en: "as % of", id: "terhadap" },
  payout: { en: "Total paid out", id: "Total pembayaran" },
  entries: { en: "entries", id: "entri" },
  table: { en: "Per-row detail", id: "Rincian per baris" },
} satisfies Record<string, Words>;

function pick(words: Words, locale: ReportLocale): string {
  return words[locale] ?? words.en;
}

/** "Highest Gaji Pokok" in English, "Gaji Pokok tertinggi" in Indonesian: the adjective moves. */
function extremeLabel(words: Words, column: string, locale: ReportLocale): string {
  return locale === "id" ? `${column} ${pick(words, locale)}` : `${pick(words, locale)} ${column}`;
}

function metric(key: string, label: string, value: number, unit: string, period: string, formula: string): Metric {
  return { key, label, value, unit, period, formula };
}

function columnMetrics(
  column: RegisterColumnStats,
  reading: RegisterReading,
  currency: string,
  locale: ReportLocale,
): Metric[] {
  const period = reading.period;
  const of = `${pick(WORDS.count, locale)} ${reading.entity || pick(WORDS.entries, locale)}`.trim();
  const rows = column.count === reading.rows.length ? [] : [
    metric(
      suffixed(`register_rows ${column.label}`, period),
      suffixed(`${pick(WORDS.count, locale)} ${pick(WORDS.rows, locale)} ${column.label}`, period),
      column.count,
      "",
      period,
      `rows with a ${column.label}`,
    ),
  ];
  return [
    metric(suffixed(`register_total ${column.label}`, period), suffixed(`${pick(WORDS.total, locale)} ${column.label}`, period), column.total, currency, period, `sum of ${column.label} over ${of}`),
    metric(suffixed(`register_average ${column.label}`, period), suffixed(`${pick(WORDS.average, locale)} ${column.label}`, period), column.average, currency, period, `${column.label} total / ${column.count}`),
    metric(suffixed(`register_median ${column.label}`, period), suffixed(`${pick(WORDS.median, locale)} ${column.label}`, period), column.median, currency, period, `middle ${column.label} of ${column.count} rows`),
    metric(suffixed(`register_max ${column.label}`, period), suffixed(extremeLabel(WORDS.highest, column.label, locale), period), column.max, currency, period, `largest ${column.label}`),
    metric(suffixed(`register_min ${column.label}`, period), suffixed(extremeLabel(WORDS.lowest, column.label, locale), period), column.min, currency, period, `smallest ${column.label}`),
    ...rows,
  ];
}

/** Each component column against the biggest one: "tunjangan is 20% of gaji pokok". */
function shareMetrics(reading: RegisterReading, locale: ReportLocale): Metric[] {
  const base = reading.base;
  if (!base || base.total === 0) {
    return [];
  }
  return reading.columns
    .filter((column) => !column.net && !column.extra && column.label !== base.label)
    .map((column) =>
      metric(
        suffixed(`register_share ${column.label}`, reading.period),
        suffixed(`${column.label} ${pick(WORDS.against, locale)} ${base.label}`, reading.period),
        (column.total / base.total) * 100,
        "%",
        reading.period,
        `${column.label} total / ${base.label} total`,
      ),
    );
}

/** Every figure a register supports, all of it arithmetic over the rows the owner confirmed. */
export function registerMetrics(items: readonly LineItem[], currency: string, locale: ReportLocale): Metric[] {
  const reading = readRegister(items);
  if (!reading) {
    return [];
  }
  const entity = reading.entity || pick(WORDS.entries, locale);
  return [
    metric(
      suffixed("register_count", reading.period),
      suffixed(`${pick(WORDS.count, locale)} ${entity}`, reading.period),
      reading.rows.length,
      "",
      reading.period,
      "rows in the register",
    ),
    ...reading.columns.flatMap((column) => columnMetrics(column, reading, currency, locale)),
    ...shareMetrics(reading, locale),
    ...(reading.payout === null
      ? []
      : [
          metric(
            suffixed("register_payout", reading.period),
            suffixed(pick(WORDS.payout, locale), reading.period),
            reading.payout,
            currency,
            reading.period,
            "bottom line plus every separate payment beside it",
          ),
        ]),
  ];
}

/** The register itself, one row per entity and one column per amount the sheet held. */
export function registerTable(items: readonly LineItem[], locale: ReportLocale): NamedTable | null {
  const reading = readRegister(items);
  if (!reading) {
    return null;
  }
  const labels = reading.columns.map((column) => column.label);
  return {
    name: pick(WORDS.table, locale),
    columns: [reading.entity || pick(WORDS.entries, locale), ...labels],
    rows: reading.rows.map((row) => [
      row.label,
      ...labels.map((label) => (row.columns ?? []).find((cell) => cell.label === label)?.amount ?? null),
    ]),
  };
}
