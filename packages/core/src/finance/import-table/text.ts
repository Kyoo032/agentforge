/**
 * One sheet to the plain figures text the paste box takes.
 *
 * Three shapes, one rule: every numeric cell is normalised on the way out, in every path including
 * the fallback, so a "(1,450,000,000)" never reaches a prompt with its brackets and its commas on.
 * - Wide (two or more period columns): the period headers stay on the first line, one row per line.
 * - Ledger (date / category / direction / amount): aggregated to month × category, signs kept.
 * - Narrow: "Rent (Jan): 1200" lines, the sentences the parse endpoint already sees.
 *
 * What the reader could not keep comes back as warnings rather than disappearing, and a row that is a
 * total of the rows above it is tagged `[subtotal]` so the parse step can leave it out of the items.
 */
import {
  FINANCE_FIGURES_TEXT_MAX,
  type FinanceFiguresText,
  type FinanceImportWarning,
  type FinanceSheet,
} from "./limits";
import { findHeaderIndex, sheetFacts, splitBlocks, type SheetBlock } from "./layout";
import { aggregateLedger, ledgerColumns } from "./long-format";
import { type NumberStyle, normalizeAmount, sheetNumberStyle } from "./numbers";
import { financePeriodHeaders, isPeriodHeader, isPeriodLabel } from "./periods";
import {
  DERIVED_TAG,
  derivedFlags,
  droppedColumnsWarning,
  droppedRowsWarning,
  noteLine,
  rowContexts,
  tagged,
} from "./block-rows";
import { isRowCounterColumn } from "./register";
import { registerSheetLines } from "./register-text";

export { DERIVED_TAG };
/** Share of a column's filled cells that must be figures before it is the value column. */
const NUMERIC_COLUMN_SHARE = 0.6;

type ReadAmount = (cell: string) => string | null;

function headerCell(cell: string, index: number): string {
  if (cell !== "") {
    return cell;
  }
  return index === 0 ? "Label" : `Column ${index + 1}`;
}

/** Wide tables keep their shape: the period headers stay on the first line, one row per line below. */
function wideLines(block: SheetBlock, style: NumberStyle, amount: ReadAmount): { lines: string[]; dropped: string[] } {
  const periods = financePeriodHeaders(block.header);
  const columns = periods.map((period) => period.index);
  const labelAt = block.header.findIndex((_cell, index) => !columns.includes(index));
  const contexts = rowContexts(block.body, Math.max(labelAt, 0));
  const flags = derivedFlags(block.body, contexts, columns, style);
  const emitted = block.body.flatMap((row, index) => {
    const context = contexts[index] ?? { section: "", kind: "row" as const, label: "" };
    if (context.kind === "note") {
      return [{ line: noteLine(context), dropped: "" }];
    }
    if (context.kind === "heading") {
      return [{ line: "", dropped: context.section === "" ? context.label : "" }];
    }
    if (!columns.some((at) => amount(row[at] ?? "") !== null)) {
      return [{ line: "", dropped: context.label }];
    }
    const cells = row.map((cell, at) => (at === Math.max(labelAt, 0) ? cell : (amount(cell) ?? cell)));
    const label = tagged(flags[index] ?? false, context.section, cells[Math.max(labelAt, 0)] ?? "");
    return [
      {
        line: [...cells.slice(0, Math.max(labelAt, 0)), label, ...cells.slice(Math.max(labelAt, 0) + 1)].join(" | "),
        dropped: "",
      },
    ];
  });
  return {
    lines: [block.header.map(headerCell).join(" | "), ...emitted.map((entry) => entry.line).filter((l) => l !== "")],
    dropped: emitted.map((entry) => entry.dropped).filter((entry) => entry !== ""),
  };
}

/** `Label | Jan=54200000 | Feb=51800000` — the same rows with every empty cell left out. */
function compactLines(block: SheetBlock, style: NumberStyle, amount: ReadAmount): string[] {
  const periods = financePeriodHeaders(block.header);
  const wide = wideLines(block, style, amount);
  const [, ...rows] = wide.lines;
  return rows.map((line) => {
    const cells = line.split(" | ");
    const label = cells[0] ?? "";
    const pairs = periods.flatMap((period) => {
      const cell = cells[period.index] ?? "";
      return cell.trim() === "" ? [] : [`${period.label}=${cell}`];
    });
    return [label, ...pairs].join(" | ");
  });
}

function numericColumn(body: ReadonlyArray<ReadonlyArray<string>>, index: number, amount: ReadAmount): boolean {
  const filled = body.map((row) => row[index] ?? "").filter((cell) => cell !== "");
  const numbers = filled.filter((cell) => amount(cell) !== null).length;
  return filled.length > 0 && numbers / filled.length >= NUMERIC_COLUMN_SHARE;
}

function narrowColumns(
  header: ReadonlyArray<string>,
  body: ReadonlyArray<ReadonlyArray<string>>,
  amount: ReadAmount,
): { label: number; value: number; period: number } {
  const periods = header.flatMap((cell, index) => (isPeriodLabel(cell) || isPeriodHeader(cell) ? [index] : []));
  const candidates = header.map((_cell, index) => index).filter((index) => !periods.includes(index));
  const counters = candidates.filter((index) => isRowCounterColumn(header[index] ?? "", body, index));
  const usable = candidates.filter((index) => !counters.includes(index));
  const value = usable.filter((index) => numericColumn(body, index, amount)).at(-1) ?? -1;
  // The label is the first column of names, not the row numbers a payroll sheet starts with.
  const label =
    usable.find((index) => index !== value && !numericColumn(body, index, amount)) ??
    usable.find((index) => index !== value) ??
    candidates.find((index) => index !== value) ??
    -1;
  return { label, value, period: periods.length === 1 ? (periods[0] ?? -1) : -1 };
}

/** Narrow tables read as the sentences the parse endpoint already sees: "Rent (Jan): 1200". */
function narrowLines(
  block: SheetBlock,
  style: NumberStyle,
  amount: ReadAmount,
): { lines: string[]; dropped: string[]; columns: string[] } {
  const { label, value, period } = narrowColumns(block.header, block.body, amount);
  if (value < 0) {
    // Nothing numeric to name: hand the rows over as written, still with every figure normalised.
    return {
      lines: [
        block.header.map(headerCell).join(" | "),
        ...block.body.map((row) => row.map((cell) => amount(cell) ?? cell).join(" | ")),
      ],
      dropped: [],
      columns: [],
    };
  }
  const labelAt = Math.max(label, 0);
  const contexts = rowContexts(block.body, labelAt);
  const flags = derivedFlags(block.body, contexts, [value], style);
  const fallbackLabel = block.header[value] || "Amount";
  const emitted = block.body.flatMap((row, index) => {
    const context = contexts[index] ?? { section: "", kind: "row" as const, label: "" };
    if (context.kind === "note") {
      return [{ line: noteLine(context), dropped: "" }];
    }
    const figure = amount(row[value] ?? "");
    if (figure === null || context.kind === "heading") {
      return [{ line: "", dropped: context.kind === "heading" ? "" : context.label }];
    }
    const name = (label >= 0 ? row[label] : "") || fallbackLabel;
    const when = period >= 0 ? (row[period] ?? "") : "";
    return [
      {
        line: `${tagged(flags[index] ?? false, context.section, name)}${when ? ` (${when})` : ""}: ${figure}`,
        dropped: "",
      },
    ];
  });
  const kept = new Set([label, value, period].filter((index) => index >= 0));
  return {
    lines: emitted.map((entry) => entry.line).filter((line) => line !== ""),
    dropped: emitted.map((entry) => entry.dropped).filter((entry) => entry !== ""),
    columns: block.header.flatMap((cell, index) => (kept.has(index) ? [] : [headerCell(cell, index)])),
  };
}

/** A transaction list read as one figure per month and category, with the operating totals under it. */
function ledgerLines(
  block: SheetBlock,
  style: NumberStyle,
): { lines: string[]; warnings: ReadonlyArray<FinanceImportWarning> } | null {
  const columns = ledgerColumns(block.header, block.body, style);
  if (!columns) {
    return null;
  }
  const ledger = aggregateLedger(block.body, columns, style);
  if (ledger.groups.length === 0) {
    return null;
  }
  const financing = [...new Set(ledger.groups.filter((group) => group.financing).map((group) => group.category))];
  return {
    lines: [
      `Ledger: ${block.body.length} rows summed to one figure per month and category (signs as written)`,
      ...financing.map((name) => `Note: ${name} is financing, so it is outside operating cash in and cash out`),
      ...ledger.groups.map((group) => `${group.category} (${group.month}): ${group.amount}`),
      ...ledger.totals.flatMap((total) => [
        `${DERIVED_TAG} Operating cash in (${total.month}): ${total.cashIn}`,
        `${DERIVED_TAG} Operating cash out (${total.month}): ${total.cashOut}`,
      ]),
    ],
    warnings: ledger.warnings,
  };
}

function blockLines(
  block: SheetBlock,
  style: NumberStyle,
  amount: ReadAmount,
): { lines: string[]; warnings: FinanceImportWarning[] } {
  const ledger = ledgerLines(block, style);
  if (ledger) {
    return { lines: ledger.lines, warnings: [...ledger.warnings] };
  }
  const periods = financePeriodHeaders(block.header);
  // One period column is enough to keep the table's shape: the header then carries the period for
  // every value under it, which is what stops a two-year sheet being summed across its years.
  if (periods.length >= 1) {
    const wide = wideLines(block, style, amount);
    return { lines: wide.lines, warnings: droppedRowsWarning(wide.dropped) };
  }
  const narrow = narrowLines(block, style, amount);
  return {
    lines: narrow.lines,
    warnings: [...droppedRowsWarning(narrow.dropped), ...droppedColumnsWarning(narrow.columns)],
  };
}

function capLines(lines: ReadonlyArray<string>): { text: string; cut: number } {
  const kept = lines.reduce<{ lines: string[]; length: number }>(
    (acc, line) => {
      const length = acc.length + line.length + (acc.lines.length === 0 ? 0 : 1);
      return length > FINANCE_FIGURES_TEXT_MAX ? acc : { lines: [...acc.lines, line], length };
    },
    { lines: [], length: 0 },
  );
  return { text: kept.lines.join("\n"), cut: lines.length - kept.lines.length };
}

function totalLength(lines: ReadonlyArray<string>): number {
  return lines.reduce((sum, line) => sum + line.length + 1, -1);
}

/**
 * One sheet to the figures text, plus everything the reader could not keep. Wide sheets that would not
 * fit are rewritten as `period=value` pairs first — lossless, and far shorter for a sparse table —
 * and only then cut on a line boundary.
 */
export function financeFiguresFromSheet(sheet: FinanceSheet): FinanceFiguresText {
  const rows = sheet.rows;
  if (rows.length < 2) {
    return { text: "", warnings: [] };
  }
  const style = sheetNumberStyle(rows);
  const amount: ReadAmount = (cell) => normalizeAmount(cell, style);
  const headerAt = findHeaderIndex(rows);
  const header = rows[headerAt] ?? [];
  const facts = [...(sheet.facts ?? []), ...sheetFacts(rows.slice(0, headerAt), amount)];
  const blocks = splitBlocks(header, rows.slice(headerAt + 1));
  const oneBlock = (block: SheetBlock) => blockLines(block, style, amount);
  // A register sheet is read whole: a second block about the same people belongs to the first one's
  // rows. Every other sheet is read a block at a time, exactly as it was.
  const read = registerSheetLines(blocks, rows, style, amount, oneBlock) ?? blocks.map(oneBlock);
  const body = read.flatMap((entry) => entry.lines);
  const head = [`Sheet: ${sheet.name}`, ...facts.map((fact) => `${fact.label}: ${fact.value}`)];
  const warnings = read.flatMap((entry) => entry.warnings);
  // A block that is not wide has no period=value form, so it keeps the lines it already had: the
  // compact rewrite must never be the reason a ledger or a note stops being in the text.
  const compact =
    totalLength([...head, ...body]) > FINANCE_FIGURES_TEXT_MAX
      ? blocks.flatMap((block, at) =>
          financePeriodHeaders(block.header).length >= 1 ? compactLines(block, style, amount) : (read[at]?.lines ?? []),
        )
      : [];
  const lines =
    compact.length > 0 && totalLength([...head, ...compact]) < totalLength([...head, ...body]) ? compact : body;
  const capped = capLines([...head, ...lines]);
  return {
    text: capped.text,
    warnings: [
      ...warnings,
      ...(lines === compact
        ? [
            {
              code: "compacted" as const,
              message: "The sheet was written as period=value pairs so it would fit the figures cap",
              detail: [`${lines.length} rows`],
            },
          ]
        : []),
      ...(capped.cut > 0
        ? [
            {
              code: "truncated" as const,
              message: `${capped.cut} lines were cut at the ${FINANCE_FIGURES_TEXT_MAX} character figures cap`,
              detail: [`${capped.cut} lines`],
            },
          ]
        : []),
    ],
  };
}

/** The figures text on its own, for the callers that do not read the warnings. */
export function tableToFiguresText(sheet: FinanceSheet): string {
  return financeFiguresFromSheet(sheet).text;
}
