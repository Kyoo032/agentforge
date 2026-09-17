/**
 * Sheet rows to confirmed line items, with the model left one job.
 *
 * Labels, periods, signs and amounts are already exact by the time this runs, so nothing here may
 * change a number. It decides two things: which rows are totals (and must therefore never be summed),
 * and what category each remaining row belongs to. The dictionary and the subtotal above a run answer
 * most labels; the ones left over are handed out by name only, and the answers come back by row id,
 * so a model can rename a category and still never touch an amount.
 */
import { splitDerivedLineItems } from "./derived-rows";
import type { FigureRow } from "./figures-text";
import { categoriseRows, roleOf } from "./line-item-normalise";
import { isCountRow } from "./count-rows";
import { LINE_ITEM_CATEGORIES, type LineItem, type LineItemCategory } from "./types";

/** A label the dictionary could not place, offered to the model on its own. */
export type UnclassifiedLabel = { readonly id: string; readonly label: string; readonly section: string };

export type FigureRowsRead = {
  /** The rows that may be summed. */
  readonly items: LineItem[];
  /** The totals the source printed, kept for display and for cross-checking. */
  readonly derived: LineItem[];
  /** Labels the dictionary left as `other`, for the categories-only model pass. */
  readonly unclassified: UnclassifiedLabel[];
};

/** Rows collapsed to one entry per label, in sheet order — the unit a category is decided for. */
function labelOrder(rows: readonly FigureRow[]): Array<{ label: string; section: string; derived: boolean }> {
  const seen = new Map<string, { label: string; section: string; derived: boolean }>();
  const order: string[] = [];
  for (const row of rows) {
    const existing = seen.get(row.label);
    if (existing) {
      seen.set(row.label, { ...existing, derived: existing.derived || row.derived });
      continue;
    }
    order.push(row.label);
    seen.set(row.label, { label: row.label, section: row.section, derived: row.derived });
  }
  return order.map((label) => seen.get(label) as { label: string; section: string; derived: boolean });
}

/** A label carries no category of its own once its role, its section and its subtotal have spoken. */
function isUnplaced(label: string, category: LineItemCategory): boolean {
  return category === "other" && roleOf(label) === null;
}

export type FigureRowsOptions = {
  /** Category per label id, from the model's labels-only pass. Amounts are never taken from it. */
  readonly categories?: ReadonlyMap<string, LineItemCategory>;
};

export function lineItemsFromRows(rows: readonly FigureRow[], options: FigureRowsOptions = {}): FigureRowsRead {
  const order = labelOrder(rows);
  const categories = categoriseRows(order);
  const byLabel = new Map<string, LineItemCategory>();
  const unclassified: UnclassifiedLabel[] = [];
  order.forEach((entry, at) => {
    const dictionary = categories[at] ?? "other";
    const supplied = options.categories?.get(labelId(at));
    const category = isUnplaced(entry.label, dictionary) && supplied ? supplied : dictionary;
    byLabel.set(entry.label, category);
    if (isUnplaced(entry.label, category)) {
      unclassified.push({ id: labelId(at), label: entry.label, section: entry.section });
    }
  });
  const items = rows.map((row) => ({
    label: row.label,
    period: row.period,
    amount: row.amount,
    currency: row.currency,
    category: byLabel.get(row.label) ?? "other",
    ...(row.derived ? { derived: true } : {}),
    // A register row's other columns ride with it: the engine needs the whole row to describe the
    // sheet, and nothing downstream may turn one of them into a line of its own.
    ...(row.columns && row.columns.length > 0 ? { columns: [...row.columns] } : {}),
  }));
  const split = splitDerivedLineItems(items, { tagged: items.map((item) => item.derived === true) });
  return { items: split.items, derived: split.derived, unclassified };
}

/** Stable id for a label, so the model answers about a row it can never rewrite. */
export function labelId(index: number): string {
  return `L${index + 1}`;
}

/** Category names the model may answer with, so an unknown string is dropped rather than stored. */
export function readCategory(value: unknown): LineItemCategory | null {
  return typeof value === "string" && (LINE_ITEM_CATEGORIES as readonly string[]).includes(value)
    ? (value as LineItemCategory)
    : null;
}

/** Count rows are never money: they stay as items and stay out of every monetary total. */
export function isNonMonetary(item: LineItem): boolean {
  return item.category === "other" && isCountRow(item);
}
