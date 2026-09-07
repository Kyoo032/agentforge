import type { NamedTable } from "../artifacts/data-analysis";
import {
  breakevenRevenue,
  breakevenUnits,
  growthRates,
  irr,
  marginPercent,
  npv,
  ratioSet,
  runwayMonths,
  sumBy,
  totalsByPeriod,
} from "./engine";
import type { LineItem, Metric } from "./types";

/** Optional knobs the user may set beside the line items. All optional; missing means the metric is skipped. */
export type FinanceParams = {
  discountRatePercent?: number;
  pricePerUnit?: number;
  variableCostPerUnit?: number;
  fixedCosts?: number;
};

export type ComputedFinance = {
  metrics: Metric[];
  tables: NamedTable[];
  /** Every number the narrative may use: inputs and computed values. */
  allowed: number[];
};

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

function periodMetrics(items: readonly LineItem[], currency: string): Metric[] {
  const revenue = totalsByPeriod(items, "revenue");
  const out: Metric[] = [];
  for (const row of revenue) {
    const cogs = sumBy(items, "cogs", row.period);
    const opex = sumBy(items, "opex", row.period);
    const gross = cogs === null ? null : row.total - cogs;
    const net = gross === null ? (opex === null ? null : row.total - opex) : gross - (opex ?? 0);
    const suffix = row.period ? ` ${row.period}` : "";
    out.push(metric(`revenue${suffix}`, `Revenue${suffix}`, row.total, currency, row.period, "sum(revenue)"));
    if (cogs !== null) {
      out.push(metric(`gross_profit${suffix}`, `Gross profit${suffix}`, gross, currency, row.period, "revenue - cogs"));
      out.push(
        metric(
          `gross_margin${suffix}`,
          `Gross margin${suffix}`,
          marginPercent(row.total, cogs),
          "%",
          row.period,
          "(revenue - cogs) / revenue",
        ),
      );
    }
    if (opex !== null) {
      out.push(metric(`opex${suffix}`, `Operating expenses${suffix}`, opex, currency, row.period, "sum(opex)"));
    }
    if (net !== null) {
      const totalCost = (cogs ?? 0) + (opex ?? 0);
      out.push(
        metric(`net_profit${suffix}`, `Net profit${suffix}`, net, currency, row.period, "revenue - cogs - opex"),
      );
      out.push(
        metric(
          `net_margin${suffix}`,
          `Net margin${suffix}`,
          marginPercent(row.total, totalCost),
          "%",
          row.period,
          "net / revenue",
        ),
      );
    }
  }
  const growth = growthRates(revenue.map((row) => row.total));
  revenue.forEach((row, index) => {
    const rate = growth[index];
    if (rate !== null && rate !== undefined) {
      const suffix = row.period ? ` ${row.period}` : "";
      out.push(
        metric(`revenue_growth${suffix}`, `Revenue growth${suffix}`, rate, "%", row.period, "vs previous period"),
      );
    }
  });
  return out;
}

function cashMetrics(items: readonly LineItem[], currency: string): Metric[] {
  const cash = sumBy(items, "cash");
  const opex = sumBy(items, "opex");
  const revenue = sumBy(items, "revenue");
  if (cash === null) {
    return [];
  }
  const out = [metric("cash", "Cash on hand", cash, currency, "", "sum(cash)")];
  const periods = totalsByPeriod(items, "opex").length || 1;
  const burn = opex === null ? null : (opex - (revenue ?? 0)) / periods;
  if (burn !== null && burn > 0) {
    out.push(metric("burn", "Net burn per period", burn, currency, "", "(opex - revenue) / periods"));
    out.push(metric("runway", "Runway", runwayMonths(cash, burn), "months", "", "cash / burn"));
  }
  return out;
}

function ratioMetrics(items: readonly LineItem[]): Metric[] {
  const ratios = ratioSet({
    currentAssets: sumBy(items, "asset") ?? undefined,
    currentLiabilities: sumBy(items, "liability") ?? undefined,
    totalDebt: sumBy(items, "debt") ?? undefined,
    totalEquity: sumBy(items, "equity") ?? undefined,
  });
  const out: Metric[] = [];
  if (ratios.currentRatio !== null) {
    out.push(metric("current_ratio", "Current ratio", ratios.currentRatio, "x", "", "assets / liabilities"));
  }
  if (ratios.debtToEquity !== null) {
    out.push(metric("debt_to_equity", "Debt to equity", ratios.debtToEquity, "x", "", "debt / equity"));
  }
  return out;
}

function paramMetrics(items: readonly LineItem[], params: FinanceParams, currency: string): Metric[] {
  const out: Metric[] = [];
  if (
    params.fixedCosts !== undefined &&
    params.pricePerUnit !== undefined &&
    params.variableCostPerUnit !== undefined
  ) {
    out.push(
      metric(
        "breakeven_units",
        "Breakeven units",
        breakevenUnits(params.fixedCosts, params.pricePerUnit, params.variableCostPerUnit),
        "",
        "",
        "fixed / (price - variable)",
      ),
    );
    const contribution =
      params.pricePerUnit === 0
        ? null
        : ((params.pricePerUnit - params.variableCostPerUnit) / params.pricePerUnit) * 100;
    if (contribution !== null) {
      out.push(
        metric(
          "breakeven_revenue",
          "Breakeven revenue",
          breakevenRevenue(params.fixedCosts, contribution),
          currency,
          "",
          "fixed / contribution margin",
        ),
      );
    }
  }
  const flows = totalsByPeriod(items, "cash").map((row) => row.total);
  if (flows.length >= 2 && params.discountRatePercent !== undefined) {
    out.push(
      metric(
        "npv",
        "Net present value",
        npv(params.discountRatePercent / 100, flows),
        currency,
        "",
        `flows at ${params.discountRatePercent}%`,
      ),
    );
    const rate = irr(flows);
    out.push(metric("irr", "Internal rate of return", rate === null ? null : rate * 100, "%", "", "npv = 0"));
  }
  return out;
}

function lineItemTable(items: readonly LineItem[]): NamedTable {
  return {
    name: "Line items",
    columns: ["Label", "Period", "Category", "Amount", "Currency"],
    rows: items.map((item) => [item.label, item.period, item.category, item.amount, item.currency]),
  };
}

function totalsTable(items: readonly LineItem[]): NamedTable | null {
  const periods = totalsByPeriod(items).map((row) => row.period);
  if (periods.length < 2) {
    return null;
  }
  const categories = ["revenue", "cogs", "opex", "cash"] as const;
  const rows = categories
    .map((category) => [category, ...periods.map((period) => sumBy(items, category, period))])
    .filter((row) => row.slice(1).some((value) => value !== null));
  return { name: "Totals by period", columns: ["Category", ...periods.map((period) => period || "(none)")], rows };
}

/** Everything the brief may state as a number, computed in code from the user's own line items. */
export function computeFinance(items: readonly LineItem[], params: FinanceParams = {}): ComputedFinance {
  const currency = currencyOf(items);
  const metrics = [
    ...periodMetrics(items, currency),
    ...cashMetrics(items, currency),
    ...ratioMetrics(items),
    ...paramMetrics(items, params, currency),
  ];
  const totals = totalsTable(items);
  const tables = totals ? [lineItemTable(items), totals] : [lineItemTable(items)];
  // Every per-category subtotal shown in "Totals by period" is a legitimate figure to cite.
  const subtotals = (totals?.rows ?? []).flatMap((row) =>
    row.filter((cell): cell is number => typeof cell === "number"),
  );
  const allowed = [
    ...items.map((item) => item.amount),
    ...metrics.map((entry) => entry.value).filter((value): value is number => value !== null),
    ...totalsByPeriod(items).map((row) => row.total),
    ...subtotals,
    ...Object.values(params).filter((value): value is number => typeof value === "number"),
  ];
  return { metrics, tables, allowed };
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
