import type { NamedTable } from "../artifacts/data-analysis";
import { breakevenRevenue, breakevenUnits, irr, npv, ratioSet, sumBy, totalsByPeriod } from "./engine";
import { countNoun, isCountAmount, isCountRow } from "./count-rows";
import { dropDerivedLineItems } from "./derived-rows";
import { fiscalYearGroups } from "./fiscal-periods";
import { aggregateBases, figuresFrom, periodBase, type PeriodFigures } from "./period-figures";
import { periodLadderMetrics, suffixed } from "./period-metrics";
import { registerMetrics, registerTable } from "./register-metrics";
import { breakevenPeriodMetric, burnMetrics, trendMetrics, type TrendOptions } from "./trend-metrics";
import type { ReportLocale } from "./report";
import type { LineItem, Metric } from "./types";

/** Optional knobs the user may set beside the line items. All optional; missing means the metric is skipped. */
export type FinanceParams = {
  discountRatePercent?: number;
  pricePerUnit?: number;
  variableCostPerUnit?: number;
  fixedCosts?: number;
};

export type FinanceComputeOptions = { readonly locale?: ReportLocale };

/** One row the source stated for itself, checked against what we computed for the same thing. */
export type StatedCheck = {
  readonly label: string;
  readonly period: string;
  readonly stated: number;
  readonly computed: number | null;
  readonly matches: boolean | null;
};

export type ComputedFinance = {
  metrics: Metric[];
  tables: NamedTable[];
  /** Every number the narrative may use: inputs and computed values. */
  allowed: number[];
  /** Subtotals the source printed, and whether our own arithmetic agrees with them. */
  checks: StatedCheck[];
};

const CHECK_RELATIVE_TOLERANCE = 0.005;
const CHECK_ABSOLUTE_TOLERANCE = 1;

function metric(
  key: string,
  label: string,
  value: number | null,
  unit: string,
  period: string,
  formula: string,
): Metric {
  return { key, label, value, unit, period, formula };
}

function currencyOf(items: readonly LineItem[]): string {
  return items.find((item) => item.currency)?.currency ?? "";
}

function periodsOf(items: readonly LineItem[]): string[] {
  return totalsByPeriod(items).map((row) => row.period);
}

function ratioMetrics(items: readonly LineItem[], locale: ReportLocale): Metric[] {
  const ratios = ratioSet({
    currentAssets: sumBy(items, "asset") ?? undefined,
    currentLiabilities: sumBy(items, "liability") ?? undefined,
    totalDebt: sumBy(items, "debt") ?? undefined,
    totalEquity: sumBy(items, "equity") ?? undefined,
  });
  const labels = {
    current: { en: "Current ratio", id: "Rasio lancar" },
    debt: { en: "Debt to equity", id: "Utang terhadap ekuitas" },
  };
  return [
    ...(ratios.currentRatio === null
      ? []
      : [metric("current_ratio", labels.current[locale], ratios.currentRatio, "x", "", "assets / liabilities")]),
    ...(ratios.debtToEquity === null
      ? []
      : [metric("debt_to_equity", labels.debt[locale], ratios.debtToEquity, "x", "", "debt / equity")]),
  ];
}

const COUNT_TOTAL_LABELS = { en: "Total", id: "Jumlah" } as const;

/**
 * "Jumlah Karyawan Tetap 46" and "Jumlah Karyawan Harian 29" are two halves of one headcount, and the
 * sheet never prints the 75. Rows that count the same thing are added up per period — only where
 * every row really is a count, so a "pcs" produced and a "pcs" sold are never summed together.
 */
function countMetrics(items: readonly LineItem[], periods: readonly string[], locale: ReportLocale): Metric[] {
  const counts = items.filter((item) => isCountRow(item) && isCountAmount(item.amount));
  return periods.flatMap((period) => {
    const groups = new Map<string, LineItem[]>();
    for (const item of counts.filter((entry) => entry.period === period)) {
      const noun = countNoun(item.label);
      if (noun) {
        groups.set(noun, [...(groups.get(noun) ?? []), item]);
      }
    }
    return [...groups].flatMap(([noun, rows]) =>
      rows.length < 2
        ? []
        : [
            metric(
              suffixed(`count_${noun}`, period),
              suffixed(`${COUNT_TOTAL_LABELS[locale]} ${noun}`, period),
              rows.reduce((sum, row) => sum + row.amount, 0),
              "",
              period,
              `sum of ${rows.length} rows counting ${noun}`,
            ),
          ],
    );
  });
}

const PARAM_LABELS = {
  units: { en: "Breakeven units", id: "Unit impas" },
  revenue: { en: "Breakeven revenue", id: "Pendapatan impas" },
  contribution: { en: "Contribution margin", id: "Marjin kontribusi" },
  npv: { en: "Net present value", id: "Nilai kini bersih" },
  irr: { en: "Internal rate of return", id: "Tingkat pengembalian internal" },
} as const;

function breakevenMetrics(params: FinanceParams, currency: string, locale: ReportLocale): Metric[] {
  const { fixedCosts, pricePerUnit, variableCostPerUnit } = params;
  if (fixedCosts === undefined || pricePerUnit === undefined || variableCostPerUnit === undefined) {
    return [];
  }
  const contribution = pricePerUnit === 0 ? null : ((pricePerUnit - variableCostPerUnit) / pricePerUnit) * 100;
  return [
    metric(
      "breakeven_units",
      PARAM_LABELS.units[locale],
      breakevenUnits(fixedCosts, pricePerUnit, variableCostPerUnit),
      "",
      "",
      "fixed / (price - variable)",
    ),
    ...(contribution === null
      ? []
      : [
          metric(
            "contribution_margin",
            PARAM_LABELS.contribution[locale],
            contribution,
            "%",
            "",
            "(price - variable) / price",
          ),
          metric(
            "breakeven_revenue",
            PARAM_LABELS.revenue[locale],
            breakevenRevenue(fixedCosts, contribution),
            currency,
            "",
            "fixed / contribution margin",
          ),
        ]),
  ];
}

function discountMetrics(
  items: readonly LineItem[],
  params: FinanceParams,
  currency: string,
  locale: ReportLocale,
): Metric[] {
  const flows = totalsByPeriod(items, "cash").map((row) => row.total);
  if (flows.length < 2 || params.discountRatePercent === undefined) {
    return [];
  }
  const rate = irr(flows);
  return [
    metric(
      "npv",
      PARAM_LABELS.npv[locale],
      npv(params.discountRatePercent / 100, flows),
      currency,
      "",
      `flows at ${params.discountRatePercent}%`,
    ),
    metric("irr", PARAM_LABELS.irr[locale], rate === null ? null : rate * 100, "%", "", "npv = 0"),
  ];
}

const TABLE_NAMES = {
  items: { en: "Line items", id: "Line items" },
  stated: { en: "Stated in the source", id: "Tertulis di sumber" },
  totals: { en: "Totals by period", id: "Totals by period" },
} as const;

function lineItemTable(items: readonly LineItem[]): NamedTable {
  return {
    name: TABLE_NAMES.items.en,
    columns: ["Label", "Period", "Category", "Amount", "Currency"],
    rows: items.map((item) => [item.label, item.period, item.category, item.amount, item.currency]),
  };
}

/** What we computed for the thing a stated subtotal names, so a mismatch is visible instead of silent. */
function computedForCheck(label: string, figures: PeriodFigures | undefined): number | null {
  if (!figures) {
    return null;
  }
  if (/laba kotor|gross profit/i.test(label)) {
    return figures.grossProfit;
  }
  if (/laba usaha|operating (?:income|profit|loss)/i.test(label)) {
    return figures.operatingProfit;
  }
  if (/laba sebelum pajak|profit before tax|pre-?tax/i.test(label)) {
    return figures.pretaxProfit;
  }
  if (/laba bersih|net (?:income|profit)/i.test(label)) {
    return figures.netProfit;
  }
  if (/pendapatan bersih|net revenue|net sales|total revenue/i.test(label)) {
    return figures.revenue;
  }
  if (/harga pokok|cost of revenue|cost of sales/i.test(label)) {
    return figures.cogs;
  }
  if (/beban usaha|operating expenses/i.test(label)) {
    return figures.opex;
  }
  return null;
}

function statedChecks(derived: readonly LineItem[], figures: ReadonlyMap<string, PeriodFigures>): StatedCheck[] {
  return derived.map((item) => {
    const computed = computedForCheck(item.label, figures.get(item.period));
    const tolerance = Math.max(CHECK_ABSOLUTE_TOLERANCE, Math.abs(item.amount) * CHECK_RELATIVE_TOLERANCE);
    return {
      label: item.label,
      period: item.period,
      stated: item.amount,
      computed,
      matches: computed === null ? null : Math.abs(computed - item.amount) <= tolerance,
    };
  });
}

function statedTable(checks: readonly StatedCheck[], locale: ReportLocale): NamedTable | null {
  return checks.length === 0
    ? null
    : {
        name: TABLE_NAMES.stated[locale],
        columns: ["Label", "Period", "Stated", "Computed", "Agrees"],
        rows: checks.map((check) => [
          check.label,
          check.period,
          check.stated,
          check.computed,
          check.matches === null ? "-" : check.matches ? "yes" : "no",
        ]),
      };
}

const TOTAL_ROWS = [
  ["revenue", (figures: PeriodFigures) => figures.revenue],
  ["cogs", (figures: PeriodFigures) => figures.cogs],
  ["gross profit", (figures: PeriodFigures) => figures.grossProfit],
  ["opex", (figures: PeriodFigures) => figures.opex],
  ["operating profit", (figures: PeriodFigures) => figures.operatingProfit],
  ["net profit", (figures: PeriodFigures) => figures.netProfit],
  ["cash", (figures: PeriodFigures) => figures.cash],
] as const;

function totalsTable(
  periods: readonly string[],
  figures: ReadonlyMap<string, PeriodFigures>,
  locale: ReportLocale,
): NamedTable | null {
  if (periods.length < 2) {
    return null;
  }
  const rows = TOTAL_ROWS.map(([name, read]) => [
    name,
    ...periods.map((period) => {
      const found = figures.get(period);
      return found ? read(found) : null;
    }),
  ]).filter((row) => row.slice(1).some((value) => value !== null));
  return { name: TABLE_NAMES.totals[locale], columns: ["Category", ...periods.map((p) => p || "(none)")], rows };
}

function numbersIn(tables: readonly NamedTable[]): number[] {
  return tables.flatMap((table) =>
    table.rows.flatMap((row) => row.filter((cell): cell is number => typeof cell === "number")),
  );
}

/** Everything the brief may state as a number, computed in code from the user's own line items. */
export function computeFinance(
  supplied: readonly LineItem[],
  params: FinanceParams = {},
  options: FinanceComputeOptions = {},
): ComputedFinance {
  const locale: ReportLocale = options.locale === "id" ? "id" : "en";
  // Defence in depth: the parse step already split the subtotals out, and a hand-edited list may not have.
  const items = dropDerivedLineItems(supplied);
  const derived = supplied.filter((item) => !items.includes(item));
  const currency = currencyOf(items);
  const periods = periodsOf(items);
  const figures = new Map<string, PeriodFigures>(
    periods.map((period) => [period, figuresFrom(periodBase(items.filter((item) => item.period === period)))]),
  );
  const groups = fiscalYearGroups(periods);
  for (const group of groups) {
    figures.set(
      group.label,
      figuresFrom(aggregateBases(group.periods.map((p) => periodBase(items.filter((i) => i.period === p))))),
    );
  }
  const ladderOptions = { locale, currency };
  const latestCash =
    [...periods]
      .reverse()
      .map((period) => figures.get(period)?.cash ?? null)
      .find((cash) => cash !== null) ?? null;
  const trend: TrendOptions = { locale, currency, periods, figures, groups, latestCash };
  const metrics = [
    ...periods.flatMap((period) => periodLadderMetrics(figures.get(period) as PeriodFigures, period, ladderOptions)),
    ...groups.flatMap((group) =>
      periodLadderMetrics(figures.get(group.label) as PeriodFigures, group.label, ladderOptions),
    ),
    ...countMetrics(items, periods, locale),
    // A register has no profit ladder to climb; what it has is a shape, and that is arithmetic too.
    ...registerMetrics(items, currency, locale),
    ...trendMetrics(trend),
    ...burnMetrics(items, trend),
    ...breakevenPeriodMetric(trend),
    ...ratioMetrics(items, locale),
    ...breakevenMetrics(params, currency, locale),
    ...discountMetrics(items, params, currency, locale),
  ];
  const checks = statedChecks(derived, figures);
  const stated = statedTable(checks, locale);
  const totals = totalsTable(periods, figures, locale);
  const register = registerTable(items, locale);
  const tables = [
    lineItemTable(items),
    ...(register ? [register] : []),
    ...(stated ? [stated] : []),
    ...(totals ? [totals] : []),
  ];
  const allowed = [
    ...supplied.map((item) => item.amount),
    ...metrics.map((entry) => entry.value).filter((value): value is number => value !== null),
    ...numbersIn(tables),
    ...Object.values(params).filter((value): value is number => typeof value === "number"),
  ];
  return { metrics, tables, allowed, checks };
}

const PROMPT_DECIMALS = 4;

/** Metric value as the model should see it: full precision to 4 decimals, unit attached, "missing" for null. */
export function formatMetricForPrompt(entry: Metric): string {
  if (entry.value === null) {
    return "missing";
  }
  const rounded = Number(entry.value.toFixed(PROMPT_DECIMALS));
  if (!entry.unit) {
    return String(rounded);
  }
  return entry.unit === "%" || entry.unit === "x" ? `${rounded}${entry.unit}` : `${rounded} ${entry.unit}`;
}

export { suffixed };
