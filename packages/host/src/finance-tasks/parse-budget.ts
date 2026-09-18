/**
 * Budget versus actual: the figures text read into two sides and a proposed pairing.
 *
 * The read is deterministic. `readFiguresText` already takes the labels, the periods, the sections
 * and the `[subtotal]` tags out of the importer's own output exactly, so nothing here asks a model
 * for a number — the model could only get one of them wrong. What is left to decide is which side a
 * row belongs to (its period says so), whether it is a total (its tag, its name or its arithmetic
 * says so) and which line on the other sheet it is the same as.
 *
 * That last question is the one the owner answers. The local stages propose first — an exact label,
 * then an acronym and synonym dictionary, then character trigrams — and only when both sides still
 * hold a line with no partner is the meaning stage asked for a cosine between the two LABELS
 * (`budget-embed.ts`, which is where the privacy rules for that call are written down and enforced).
 * Core blends the two and refuses to guess between two close readings; the status of that stage
 * travels back as `matching.embedding`, so a screen can say when the pairing is local-only.
 *
 * Every pair comes back with its score and the stage that produced it, and `needsConfirmation` is
 * always true: nothing is computed until the owner has looked at the table.
 */
import { ApiError } from "@agentforge/core";
import {
  isBudgetDerivedLabel,
  proposeBudgetPairs,
  readBudgetSides,
  readFiguresText,
  type BudgetPairProposal,
  type BudgetSideLine,
  type FigureRow,
  type LineItem,
  type LineItemCategory,
} from "@agentforge/core/finance";
import { guardFinanceInput, mergeFinancePii, type FinancePiiSummary } from "../finance-privacy";
import { budgetEmbedWorthwhile, embedBudgetLabels, type BudgetEmbedStatus } from "./budget-embed";
import type { FinanceTaskParser } from "./types";

const SHEET_LINE = /^Sheet:\s*(.*)$/;

const SECTION_KINDS: ReadonlyArray<readonly [RegExp, LineItemCategory]> = [
  [/harga\s*pokok|beban\s*pokok|\bhpp\b|cost of (goods|sales)|\bcogs\b/i, "cogs"],
  [/pendapatan|penerimaan|penghasilan|omzet|omset|revenue|income|sales|donasi|hibah/i, "revenue"],
  [/beban|biaya|pengeluaran|belanja|expense|operating|opex|cost/i, "opex"],
];

/** Revenue words a label can carry when its sheet never printed a section heading at all. */
const REVENUE_LABEL =
  /\b(pendapatan|penerimaan|penghasilan|donasi|hibah|sumbangan|omzet|omset|revenue|income|sales|grant|donation)\b/i;

type SheetBlock = { readonly name: string; readonly text: string };

/** The figures text cut back into the sheets it was joined from, so a sheet name can still be a period. */
function sheetBlocks(text: string): SheetBlock[] {
  const blocks: SheetBlock[] = [];
  let name = "";
  let lines: string[] = [];
  const close = (): void => {
    if (lines.length > 0) {
      blocks.push({ name, text: lines.join("\n") });
    }
  };
  for (const line of text.split(/\r?\n/)) {
    const match = SHEET_LINE.exec(line.trim());
    if (!match) {
      lines = [...lines, line];
      continue;
    }
    close();
    name = (match[1] ?? "").trim();
    lines = [];
  }
  close();
  return blocks;
}

/** The section heading decides the category; a sheet without one falls back to the label's own words. */
function categoryFor(row: FigureRow): LineItemCategory {
  const leaf = row.section.split("/").at(-1)?.trim() ?? "";
  const matched = SECTION_KINDS.find(([pattern]) => pattern.test(leaf));
  if (matched) {
    return matched[1];
  }
  return REVENUE_LABEL.test(row.label) ? "revenue" : "opex";
}

function itemFrom(row: FigureRow, sheet: string): LineItem {
  return {
    label: row.label,
    period: row.period.trim() || sheet,
    amount: row.amount,
    currency: row.currency,
    category: categoryFor(row),
  };
}

type ReadRows = { readonly items: LineItem[]; readonly derived: LineItem[] };

/** Every row the figures text holds, with the totals kept beside the items rather than inside them. */
export function budgetRowsFromFiguresText(text: string): ReadRows {
  const read = sheetBlocks(text).flatMap((block) =>
    readFiguresText(block.text).rows.map((row) => ({ row, sheet: block.name })),
  );
  const split = read.map((entry) => ({
    item: itemFrom(entry.row, entry.sheet),
    derived: entry.row.derived || isBudgetDerivedLabel(entry.row.label),
  }));
  return {
    items: split.filter((entry) => !entry.derived).map((entry) => entry.item),
    derived: split.filter((entry) => entry.derived).map((entry) => entry.item),
  };
}

function readFigures(body: unknown): string {
  const figures = (body as { figures?: unknown } | null)?.figures;
  if (typeof figures !== "string" || figures.trim() === "") {
    throw new ApiError("invalid_request", "figures text is required", 400);
  }
  return figures.trim();
}

function hintsFrom(body: unknown): { budgetPeriod?: string; actualPeriod?: string } {
  const params = (body as { params?: { budgetSheet?: unknown; actualSheet?: unknown } } | null)?.params;
  return {
    ...(typeof params?.budgetSheet === "string" ? { budgetPeriod: params.budgetSheet } : {}),
    ...(typeof params?.actualSheet === "string" ? { actualPeriod: params.actualSheet } : {}),
  };
}

export type BudgetParseResult = {
  readonly items: LineItem[];
  readonly derived: readonly LineItem[];
  readonly budget: readonly BudgetSideLine[];
  readonly actual: readonly BudgetSideLine[];
  readonly periods: readonly string[];
  readonly pairs: readonly BudgetPairProposal[];
  readonly budgetOnly: readonly string[];
  readonly actualOnly: readonly string[];
  readonly excluded: readonly { readonly label: string; readonly period: string; readonly reason: string }[];
  /** How the pairing was reached, so the screen can say when the meaning stage could not run. */
  readonly matching: { readonly embedding: BudgetEmbedStatus };
  readonly needsConfirmation: true;
  readonly pii: FinancePiiSummary;
};

export const parseBudgetInput: FinanceTaskParser = async (tenant, body): Promise<BudgetParseResult> => {
  // Redacted first: the only copy of these rows that exists past this line is the one the owner sees.
  const guardedText = guardFinanceInput({ figuresText: readFigures(body) });
  const read = budgetRowsFromFiguresText(guardedText.figuresText);
  if (read.items.length === 0) {
    throw new ApiError(
      "invalid_finance",
      "No budget rows were found in that text. Import the budget sheet and the actuals sheet, then try again.",
      422,
    );
  }
  const guardedRows = guardFinanceInput({ lineItems: read.items });
  const items = guardedRows.lineItems;
  const sides = readBudgetSides(items, hintsFrom(body));
  const local = proposeBudgetPairs(sides.budget, sides.actual);
  // Only a pairing that still has loose ends on both sides can be changed by a cosine, so only that
  // one is worth a call. Everything else is already decided by evidence a reader can check by hand.
  const embedded = budgetEmbedWorthwhile(local)
    ? await embedBudgetLabels(tenant, sides.budget, sides.actual)
    : ({ status: "not-needed" } as const);
  const pairing = embedded.similarity
    ? proposeBudgetPairs(sides.budget, sides.actual, { similarity: embedded.similarity })
    : local;
  return {
    items,
    derived: guardFinanceInput({ lineItems: read.derived }).lineItems,
    budget: sides.budget,
    actual: sides.actual,
    periods: sides.periods,
    pairs: pairing.pairs,
    budgetOnly: pairing.budgetOnly,
    actualOnly: pairing.actualOnly,
    excluded: sides.excluded,
    matching: { embedding: embedded.status },
    needsConfirmation: true,
    pii: mergeFinancePii(guardedText.pii, guardedRows.pii),
  };
};
