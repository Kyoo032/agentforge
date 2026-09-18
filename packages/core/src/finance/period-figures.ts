/**
 * The profit ladder for one period, and the same ladder for a year made of quarters.
 *
 * Two things the old single-step "net = revenue - cogs - opex" could not say, and which the owner's
 * own statements say on every page: an *operating* profit is not a *net* profit — interest, other
 * income and tax sit between them — and a cash balance is not a flow, so rolling four quarters up
 * into a year sums the flows and takes the last balance rather than adding four balances together.
 */
import { marginPercent } from "./engine";
import { conventionTotal, isNonOperatingRole, roleOf } from "./line-item-normalise";
import type { LineItem, LineItemCategory } from "./types";

/** What a period holds before anything is derived from it. Flows add up; balances do not. */
export type PeriodBase = {
  readonly revenue: number | null;
  readonly cogs: number | null;
  readonly opex: number | null;
  readonly interestExpense: number | null;
  readonly otherIncome: number | null;
  readonly taxExpense: number | null;
  readonly burn: number | null;
  readonly cash: number | null;
  /** The three sections of a cash-flow statement, each with the sign the statement printed. */
  readonly operatingCashFlow: number | null;
  readonly investingCashFlow: number | null;
  readonly financingCashFlow: number | null;
};

/** Everything a section or a KPI may state about a period. */
export type PeriodFigures = PeriodBase & {
  readonly grossProfit: number | null;
  readonly grossMarginPct: number | null;
  readonly cogsRatioPct: number | null;
  readonly operatingProfit: number | null;
  readonly operatingMarginPct: number | null;
  readonly pretaxProfit: number | null;
  readonly netProfitAfterTax: number | null;
  readonly netProfit: number | null;
  readonly netMarginPct: number | null;
  /** Operating cash after what was spent to keep earning it. */
  readonly freeCashFlow: number | null;
  /** What the three cash-flow sections add up to: how much the balance moved over the period. */
  readonly cashChange: number | null;
  /** Tax as a share of the profit it was charged on, which is rarely the headline rate. */
  readonly effectiveTaxRatePct: number | null;
  /** How many times over the operating profit covers the interest bill. */
  readonly interestCoverage: number | null;
};

const FLOW_KEYS = [
  "revenue",
  "cogs",
  "opex",
  "interestExpense",
  "otherIncome",
  "taxExpense",
  "burn",
  "operatingCashFlow",
  "investingCashFlow",
  "financingCashFlow",
] as const;

/**
 * A category's own rows. Contra-revenue and depreciation belong where they were filed — a return
 * reduces revenue and depreciation is an operating expense — so only the rows that sit *below* the
 * operating line (tax, interest, other income, a stated burn) are held back for their own metric.
 */
function amountsFor(items: readonly LineItem[], category: LineItemCategory): number[] {
  return items
    .filter((item) => item.category === category && !isNonOperatingRole(roleOf(item.label)))
    .map((item) => item.amount);
}

function roleTotal(items: readonly LineItem[], role: ReturnType<typeof roleOf>, magnitude: boolean): number | null {
  const amounts = items.filter((item) => roleOf(item.label) === role).map((item) => item.amount);
  const total = conventionTotal(amounts);
  return total === null ? null : magnitude ? Math.abs(total) : total;
}

function plus(left: number | null, right: number | null): number | null {
  return left === null && right === null ? null : (left ?? 0) + (right ?? 0);
}

/**
 * A cash-flow line keeps the sign the statement printed. `conventionTotal` would read a lone
 * `(1.312.600.000)` as a cost written negative and hand back its magnitude, which turns an outflow
 * into an inflow and makes free cash flow come out positive when it is not.
 */
function signedRoleTotal(items: readonly LineItem[], role: ReturnType<typeof roleOf>): number | null {
  const amounts = items.filter((item) => roleOf(item.label) === role).map((item) => item.amount);
  return amounts.length === 0 ? null : amounts.reduce((sum, amount) => sum + amount, 0);
}

/** The raw figures a set of rows holds. Contra-revenue keeps its sign; costs keep their magnitude. */
export function periodBase(items: readonly LineItem[]): PeriodBase {
  const otherIncome = plus(roleTotal(items, "other_income", false), roleTotal(items, "interest_income", false));
  return {
    revenue: conventionTotal(amountsFor(items, "revenue")),
    cogs: conventionTotal(amountsFor(items, "cogs")),
    opex: conventionTotal(amountsFor(items, "opex")),
    interestExpense: roleTotal(items, "interest_expense", true),
    otherIncome,
    taxExpense: roleTotal(items, "tax", true),
    burn: roleTotal(items, "burn", true),
    cash: conventionTotal(amountsFor(items, "cash")),
    operatingCashFlow: signedRoleTotal(items, "operating_cash_flow"),
    investingCashFlow: signedRoleTotal(items, "investing_cash_flow"),
    financingCashFlow: signedRoleTotal(items, "financing_cash_flow"),
  };
}

/** Flows summed, balances taken from the last period that states one. */
export function aggregateBases(bases: readonly PeriodBase[]): PeriodBase {
  const flows = Object.fromEntries(
    FLOW_KEYS.map((key) => {
      const values = bases.map((base) => base[key]).filter((value): value is number => value !== null);
      return [key, values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0)];
    }),
  ) as Pick<PeriodBase, (typeof FLOW_KEYS)[number]>;
  const balances = bases.map((base) => base.cash).filter((value): value is number => value !== null);
  return { ...flows, cash: balances.at(-1) ?? null };
}

function subtract(left: number | null, right: number | null): number | null {
  return left === null ? null : left - (right ?? 0);
}

/** The ladder: gross, operating, pre-tax, net — each one only when its inputs are there. */
export function figuresFrom(base: PeriodBase): PeriodFigures {
  const grossProfit = base.cogs === null ? null : subtract(base.revenue, base.cogs);
  const operatingBase = grossProfit ?? base.revenue;
  const operatingProfit = base.opex === null && grossProfit === null ? null : subtract(operatingBase, base.opex);
  const belowTheLine = base.interestExpense !== null || base.otherIncome !== null;
  const pretaxProfit = belowTheLine
    ? plus(subtract(operatingProfit, base.interestExpense), base.otherIncome)
    : operatingProfit;
  const netProfitAfterTax = base.taxExpense === null ? null : subtract(pretaxProfit, base.taxExpense);
  const netProfit = netProfitAfterTax ?? pretaxProfit;
  const sections = [base.operatingCashFlow, base.investingCashFlow, base.financingCashFlow];
  const cashChange = sections.every((value) => value === null)
    ? null
    : sections.reduce((sum, value) => (sum ?? 0) + (value ?? 0), 0);
  return {
    ...base,
    freeCashFlow:
      base.operatingCashFlow === null ? null : base.operatingCashFlow + (base.investingCashFlow ?? 0),
    cashChange,
    effectiveTaxRatePct: base.taxExpense === null ? null : ratioPercent(base.taxExpense, pretaxProfit),
    interestCoverage:
      operatingProfit === null || base.interestExpense === null || base.interestExpense === 0
        ? null
        : operatingProfit / base.interestExpense,
    grossProfit,
    grossMarginPct: marginPercent(base.revenue, base.cogs),
    cogsRatioPct:
      base.revenue === null || base.cogs === null || base.revenue === 0 ? null : (base.cogs / base.revenue) * 100,
    operatingProfit,
    operatingMarginPct: ratioPercent(operatingProfit, base.revenue),
    pretaxProfit,
    netProfitAfterTax,
    netProfit,
    netMarginPct: ratioPercent(netProfit, base.revenue),
  };
}

function ratioPercent(value: number | null, of: number | null): number | null {
  if (value === null || of === null || of === 0) {
    return null;
  }
  return (value / of) * 100;
}

/** The ladder for one period of a confirmed list. */
export function figuresForPeriod(items: readonly LineItem[], period: string): PeriodFigures {
  return figuresFrom(periodBase(items.filter((item) => item.period === period)));
}
