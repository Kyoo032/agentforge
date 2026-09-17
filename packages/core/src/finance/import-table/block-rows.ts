/**
 * What every emitter needs to know about a body row before it writes it out: the section it sits in,
 * whether it is a row at all, whether it is a total of the rows above it — and how to say what the
 * reader could not keep.
 *
 * This lived inside the wide/narrow writer until the register reader needed exactly the same facts.
 * Nothing here writes a figures line; it only reads the block.
 */
import { markDerivedRows } from "./derived";
import { headingDepth, isNoteRow, isSectionHeading, pushHeading } from "./layout";
import type { FinanceImportWarning } from "./limits";
import type { NumberStyle } from "./numbers";

/** The tag a derived row carries so the parse step can keep it out of the line items. */
export const DERIVED_TAG = "[subtotal]";
/** Past this many body rows a statement is a transaction list; the subtotal walk is skipped. */
export const DERIVED_MAX_ROWS = 400;

export type RowContext = {
  readonly section: string;
  readonly kind: "row" | "heading" | "note";
  readonly label: string;
};

/**
 * A single stray heading is a stray row; a sheet that groups its rows does it more than once. So a
 * mixed-case heading only opens a section when the block has at least two headings, while an ALL-CAPS
 * one always does — that is the shape of every statement that separates ASET from LIABILITAS.
 */
export function rowContexts(body: ReadonlyArray<ReadonlyArray<string>>, labelAt: number): RowContext[] {
  const headings = body.filter((row) => isSectionHeading(row) && !isNoteRow(row));
  const useAll = headings.length >= 2;
  const all: RowContext[] = [];
  for (const row of body) {
    const section = all.at(-1)?.section ?? "";
    const path = section === "" ? [] : section.split(" / ");
    const label = (row[labelAt] ?? row.find((cell) => cell.trim() !== "") ?? "").trim();
    if (isNoteRow(row)) {
      all.push({ section, kind: "note", label });
    } else if (isSectionHeading(row)) {
      const opens = useAll || headingDepth(label) === 1;
      all.push({ section: opens ? pushHeading(path, label).join(" / ") : section, kind: "heading", label });
    } else {
      all.push({ section, kind: "row", label });
    }
  }
  return all;
}

export function derivedFlags(
  body: ReadonlyArray<ReadonlyArray<string>>,
  contexts: ReadonlyArray<RowContext>,
  columns: readonly number[],
  style: NumberStyle,
): boolean[] {
  if (body.length > DERIVED_MAX_ROWS || columns.length === 0) {
    return body.map(() => false);
  }
  return markDerivedRows({
    rows: body,
    labels: contexts.map((context) => context.label),
    skipped: contexts.map((context) => context.kind !== "row"),
    columns,
    style,
  });
}

/** `[subtotal] [BEBAN USAHA] Penyusutan` — the two facts about a row that its own label cannot carry. */
export function tagged(derived: boolean, section: string, label: string): string {
  return `${derived ? `${DERIVED_TAG} ` : ""}${section === "" ? "" : `[${section}] `}${label}`;
}

export function noteLine(context: RowContext): string {
  return `Note: ${context.label}`;
}

export function droppedRowsWarning(dropped: ReadonlyArray<string>): FinanceImportWarning[] {
  return dropped.length === 0
    ? []
    : [
        {
          code: "dropped_rows" as const,
          message: `${dropped.length} rows carried no figure and were not imported`,
          detail: [...dropped],
        },
      ];
}

export function droppedColumnsWarning(columns: ReadonlyArray<string>): FinanceImportWarning[] {
  return columns.length === 0
    ? []
    : [
        {
          code: "dropped_columns" as const,
          message: `${columns.length} columns were not imported`,
          detail: [...columns],
        },
      ];
}
