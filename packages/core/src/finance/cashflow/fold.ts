/**
 * Source categories folded into the two sides of each period, and those sides written back out as
 * the rows a reader confirms.
 *
 * This lives in core because it runs twice: once in the parse hook, on the figures the importer
 * produced, and again in the studio every time the reader changes what a category *is*. A reader who
 * moves "Perlengkapan & kemasan" from fixed to variable must see the breakeven move with it, and the
 * only way that can be true is if both paths fold the same way.
 *
 * The one judgement here: in a book that signs its amounts the sign is the direction, and in a book
 * that writes every figure as a magnitude under a heading the heading is. Nothing else decides a side.
 */
import type { CashflowCategory, CashflowItem, CashflowRole } from "./types";

export type CashflowFold = {
  readonly cashIn: number;
  readonly cashOut: number;
  readonly financingIn: number;
  readonly variable: number;
  readonly fixed: number;
  readonly oneOff: number;
  readonly roles: Readonly<Partial<Record<CashflowRole, number>>>;
};

export const EMPTY_FOLD: CashflowFold = Object.freeze({
  cashIn: 0,
  cashOut: 0,
  financingIn: 0,
  variable: 0,
  fixed: 0,
  oneOff: 0,
  roles: Object.freeze({}),
});

/** What the two confirmed rows per period are called, in the language the source book was written in. */
export type CashflowRowNames = { readonly cashIn: string; readonly cashOut: string; readonly financing: string };

export const CASHFLOW_ROW_NAMES: Readonly<Record<"id" | "en", CashflowRowNames>> = Object.freeze({
  id: { cashIn: "Total kas masuk", cashOut: "Total kas keluar", financing: "Pendanaan" },
  en: { cashIn: "Operating cash in", cashOut: "Operating cash out", financing: "Financing" },
});

function addRole(
  roles: CashflowFold["roles"],
  role: CashflowRole | undefined,
  amount: number,
): CashflowFold["roles"] {
  return role === undefined ? roles : { ...roles, [role]: (roles[role] ?? 0) + amount };
}

/** One figure folded into a period's two sides and, when it left, into its cost behaviour. */
export function foldAmount(fold: CashflowFold, category: CashflowCategory, amount: number, signed: boolean): CashflowFold {
  if (category.kind === "financing") {
    return { ...fold, financingIn: fold.financingIn + amount };
  }
  const outflow = signed ? amount < 0 : category.kind === "outflow";
  if (!outflow) {
    return { ...fold, cashIn: fold.cashIn + (signed ? amount : Math.abs(amount)) };
  }
  const magnitude = Math.abs(amount);
  const behaviour = category.behaviour ?? "fixed";
  return {
    ...fold,
    cashOut: fold.cashOut + magnitude,
    variable: fold.variable + (behaviour === "variable" ? magnitude : 0),
    fixed: fold.fixed + (behaviour === "fixed" ? magnitude : 0),
    oneOff: fold.oneOff + (behaviour === "oneOff" ? magnitude : 0),
    roles: addRole(fold.roles, category.role, magnitude),
  };
}

/** True when the book signs its amounts: then the sign is the direction and a label is only advice. */
export function isSignedBook(categories: readonly CashflowCategory[]): boolean {
  return categories.some(
    (category) => category.kind !== "financing" && (category.amounts ?? []).some((entry) => entry.amount < 0),
  );
}

/** The periods these categories cover, in the order they first appear. */
export function foldPeriodOrder(categories: readonly CashflowCategory[]): string[] {
  const seen: string[] = [];
  for (const category of categories) {
    for (const entry of category.amounts ?? []) {
      if (entry.period !== "" && !seen.includes(entry.period)) {
        seen.push(entry.period);
      }
    }
  }
  return seen;
}

/** Every category's own figures folded into one answer per period. */
export function foldCategories(
  categories: readonly CashflowCategory[],
  signed: boolean = isSignedBook(categories),
): Map<string, CashflowFold> {
  const folds = new Map<string, CashflowFold>();
  for (const category of categories) {
    for (const entry of category.amounts ?? []) {
      folds.set(entry.period, foldAmount(folds.get(entry.period) ?? EMPTY_FOLD, category, entry.amount, signed));
    }
  }
  return folds;
}

export type CashflowOpening = { readonly label: string; readonly amount: number };

/**
 * The rows the reader confirms: the opening balance, then one cash-in and one cash-out row per period,
 * with the financing that moved the balance kept on a line of its own.
 *
 * The cost behaviour rides on the cash-out row rather than on twelve more rows, because the reader is
 * confirming a cash book and not re-typing the ledger — and because the maths needs exactly this.
 */
export function cashflowRowsFromFolds(options: {
  readonly order: readonly string[];
  readonly folds: ReadonlyMap<string, CashflowFold>;
  readonly names: CashflowRowNames;
  readonly currency: string;
  readonly opening?: CashflowOpening | null;
}): CashflowItem[] {
  const { order, folds, names, currency } = options;
  const openingRow: CashflowItem[] = options.opening
    ? [
        {
          label: options.opening.label,
          period: "",
          amount: options.opening.amount,
          currency,
          category: "cash",
          kind: "opening",
        },
      ]
    : [];
  return [
    ...openingRow,
    ...order.flatMap((period): CashflowItem[] => {
      const fold = folds.get(period) ?? EMPTY_FOLD;
      return [
        { label: names.cashIn, period, amount: fold.cashIn, currency, category: "revenue", kind: "inflow" },
        {
          label: names.cashOut,
          period,
          amount: fold.cashOut,
          currency,
          category: "opex",
          kind: "outflow",
          breakdown: { variable: fold.variable, fixed: fold.fixed, oneOff: fold.oneOff, roles: { ...fold.roles } },
        },
        ...(fold.financingIn === 0
          ? []
          : [
              {
                label: names.financing,
                period,
                amount: fold.financingIn,
                currency,
                category: "equity",
                kind: "financing" as const,
              },
            ]),
      ];
    }),
  ];
}
