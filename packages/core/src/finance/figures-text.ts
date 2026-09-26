/**
 * The figures text read in code, not by a model.
 *
 * Everything the importer writes — a wide table with its period headers, the compact `2023=…` form,
 * the narrow `Rent (Jan): 1200` form, `[subtotal]` tags, `[SECTION]` paths, `Note:` lines and the
 * facts it lifts out of a sheet's title band — has an exact shape, and a shape is something code
 * reads perfectly and a model reads *almost* perfectly. Almost is how an amount comes back one digit
 * short, so labels, periods and amounts are all taken here and the model is left one job it is
 * actually better at: naming the category of a label it has never seen.
 *
 * What a separator means is decided once for the whole paste, with the importer's own evidence rule:
 * `Rp 1.000` is a thousand and `$1,250.75` is one thousand two hundred fifty. Reading it per line
 * would make `Rp 1.000` a one.
 *
 * A block ends where the next header line begins, so a sheet with two tables under one another keeps
 * both, each with its own periods.
 */
import { cellValue, isPeriodHeader, isPeriodLabel, sheetNumberStyle, type NumberStyle } from "./import-table";
import { labeledAmountLines } from "./plain-sentences";
import type { RegisterCell } from "./types";

/** The tag the importer puts on a row that is a total of the rows above it. */
export const SUBTOTAL_TAG = "[subtotal]";

const SHEET_LINE = /^Sheet:\s*(.*)$/;
const NOTE_LINE = /^(?:Note|Ledger):\s*/;
const SECTION_TAG = /^\[([^\]]+)\]\s*/;
const NARROW_LINE = /^(.*?)\s*:\s*([^:]+)$/;
const PARENTHESISED_TAIL = /\s*\(([^()]+)\)\s*$/;
const COMPACT_PAIR = /^([^=]+)=(.*)$/;
/** `{Gaji Pokok=8500000; +Reimbursement=1250000}` — every amount column a register row carried. */
const REGISTER_TAIL = /\s*\{([^{}]*)\}\s*$/;
const REGISTER_PAIR = /^\s*(\+)?\s*([^=]+?)\s*=\s*(.+?)\s*$/;
const CURRENCY_PREFIX = /^\s*(Rp|IDR|USD|EUR|GBP|SGD|MYR|AUD|JPY|\$|€|£)\s*/i;
/** A day number in front of a month name: "31 Des 2024" is one date, not a 31 and a period. */
const LEADING_DAY = /^\d{1,2}\s+/;
/** Words a label ends on when the date that followed them has been taken off. */
const DANGLING_CONNECTOR = /\s+(?:per|pada|untuk|hingga|s\/d|sd|as\s+of|as\s+at|at|of|for|to|on|dated?)$/i;
/** How many trailing words are tried as the date a label ends with. */
const PERIOD_TAIL_WORDS = 4;

const CURRENCY_CODES: Record<string, string> = {
  rp: "IDR",
  $: "USD",
  "€": "EUR",
  "£": "GBP",
};

/** One row of a sheet, exactly as it was written, before any category is guessed. */
export type FigureRow = {
  readonly label: string;
  readonly period: string;
  readonly amount: number;
  readonly currency: string;
  readonly section: string;
  readonly derived: boolean;
  /** Position of the row in the sheet, so a later pass can see which rows a subtotal sits over. */
  readonly order: number;
  /** Every amount column the row had, when it came from an entity-per-row register. */
  readonly columns?: readonly RegisterCell[];
};

/** A figure the sheet states beside its table rather than inside it. */
export type StatedFigure = { readonly label: string; readonly value: number; readonly currency: string };

export type FiguresTextRead = {
  readonly rows: FigureRow[];
  readonly facts: StatedFigure[];
  readonly notes: string[];
  /** Lines that carried something but did not read as a row — the evidence this is not a table. */
  readonly unread: string[];
  /**
   * True only when every line was accounted for. A paste where half the lines read as rows is not
   * half a table: taking the half we understood would quietly drop the other half, so the whole
   * text goes to the model instead.
   */
  readonly deterministic: boolean;
};

function readCurrency(cell: string): { currency: string; rest: string } {
  const match = CURRENCY_PREFIX.exec(cell);
  if (!match) {
    return { currency: "", rest: cell.trim() };
  }
  const token = (match[1] ?? "").toLowerCase();
  return { currency: CURRENCY_CODES[token] ?? token.toUpperCase(), rest: cell.slice(match[0].length).trim() };
}

function readAmount(cell: string, style: NumberStyle): { amount: number; currency: string } | null {
  const { currency, rest } = readCurrency(cell);
  if (rest === "") {
    return null;
  }
  const amount = cellValue(rest, style);
  return amount === null || !Number.isFinite(amount) ? null : { amount, currency };
}

/** True when the words read as a date or a period, with or without a day number in front. */
function isPeriodPhrase(text: string): boolean {
  const trimmed = text.trim();
  return trimmed !== "" && (isPeriodLabel(trimmed) || isPeriodLabel(trimmed.replace(LEADING_DAY, "")));
}

/**
 * "Revenue 2025" is a revenue row for 2025, and "Saldo Kas & Setara Kas per 31 Des 2024" is a cash
 * row for December 2024 — both are one label with its period written into it. The longest trailing
 * phrase that reads as a date wins, and the connector it hung off goes with it.
 */
export function splitTrailingPeriod(label: string): { label: string; period: string } {
  const words = label.trim().split(/\s+/);
  for (let take = Math.min(PERIOD_TAIL_WORDS, words.length - 1); take >= 1; take -= 1) {
    const tail = words.slice(words.length - take).join(" ");
    if (!isPeriodPhrase(tail)) {
      continue;
    }
    const head = words
      .slice(0, words.length - take)
      .join(" ")
      .replace(DANGLING_CONNECTOR, "")
      .trim();
    if (head !== "") {
      return { label: head, period: tail.replace(LEADING_DAY, "").trim() };
    }
  }
  return { label: label.trim(), period: "" };
}

/** `[subtotal] [BEBAN USAHA] Penyusutan` split back into its three facts. */
function readLabel(raw: string): { label: string; section: string; derived: boolean } {
  const trimmed = raw.trim();
  const derived = trimmed.startsWith(SUBTOTAL_TAG);
  const withoutTag = derived ? trimmed.slice(SUBTOTAL_TAG.length).trim() : trimmed;
  const section = SECTION_TAG.exec(withoutTag);
  return {
    label: section ? withoutTag.slice(section[0].length).trim() : withoutTag,
    section: section?.[1]?.trim() ?? "",
    derived,
  };
}

function isPeriodCell(cell: string): boolean {
  return isPeriodLabel(cell) || isPeriodHeader(cell);
}

type Block = { readonly periods: ReadonlyArray<{ index: number; label: string }>; readonly labelAt: number };

/**
 * A header names its columns; a body row fills them. "190000" reads as a 1900 year label, so a line
 * is only a header when none of its cells past the first is an amount.
 */
function headerBlock(cells: readonly string[], style: NumberStyle): Block | null {
  if (cells.some((cell, index) => index > 0 && !isPeriodCell(cell) && readAmount(cell, style) !== null)) {
    return null;
  }
  const periods = cells.flatMap((cell, index) =>
    index > 0 && isPeriodCell(cell) ? [{ index, label: cell.trim() }] : [],
  );
  if (periods.length === 0) {
    return null;
  }
  const taken = new Set(periods.map((period) => period.index));
  return { periods, labelAt: cells.findIndex((_cell, index) => !taken.has(index)) };
}

function wideRows(cells: readonly string[], block: Block, order: number, style: NumberStyle): FigureRow[] {
  const read = readLabel(cells[Math.max(block.labelAt, 0)] ?? "");
  const named = splitTrailingPeriod(read.label);
  if (named.label === "") {
    return [];
  }
  return block.periods.flatMap((period) => {
    const amount = readAmount(cells[period.index] ?? "", style);
    return amount === null
      ? []
      : [{ label: named.label, period: period.label, section: read.section, derived: read.derived, order, ...amount }];
  });
}

function compactRows(cells: readonly string[], order: number, style: NumberStyle): FigureRow[] {
  const read = readLabel(cells[0] ?? "");
  const named = splitTrailingPeriod(read.label);
  return cells.slice(1).flatMap((cell) => {
    const pair = COMPACT_PAIR.exec(cell);
    const amount = pair ? readAmount(pair[2] ?? "", style) : null;
    return amount === null || !pair
      ? []
      : [
          {
            label: named.label,
            period: (pair[1] ?? "").trim(),
            section: read.section,
            derived: read.derived,
            order,
            ...amount,
          },
        ];
  });
}

/**
 * The columns in a register row's braces. They are facts about the row and never rows of their own:
 * `gaji pokok` and `gaji bersih` describe the same payment, so nothing may add them together.
 */
function readColumns(text: string, style: NumberStyle): RegisterCell[] {
  return text.split(";").flatMap((entry) => {
    const pair = REGISTER_PAIR.exec(entry);
    const amount = pair ? readAmount(pair[3] ?? "", style) : null;
    const label = (pair?.[2] ?? "").trim();
    return amount === null || label === ""
      ? []
      : [{ label, amount: amount.amount, ...(pair?.[1] ? { extra: true as const } : {}) }];
  });
}

function narrowRow(line: string, order: number, style: NumberStyle): FigureRow | null {
  const tail = REGISTER_TAIL.exec(line);
  const columns = tail ? readColumns(tail[1] ?? "", style) : [];
  const match = NARROW_LINE.exec(tail ? line.slice(0, tail.index) : line);
  if (!match) {
    return null;
  }
  const amount = readAmount(match[2] ?? "", style);
  if (amount === null) {
    return null;
  }
  const read = readLabel(match[1] ?? "");
  // "(Jan)" is the period the importer writes; "(22%)" is part of the name and stays on it.
  const parens = PARENTHESISED_TAIL.exec(read.label);
  const inParens = parens && isPeriodPhrase(parens[1] ?? "") ? parens : null;
  const base = inParens ? read.label.slice(0, inParens.index).trim() : read.label;
  const named = splitTrailingPeriod(base);
  return {
    label: named.label,
    period: (inParens?.[1] ?? named.period).trim().replace(LEADING_DAY, ""),
    section: read.section,
    derived: read.derived,
    order,
    ...amount,
    ...(columns.length > 0 ? { columns } : {}),
  };
}

/**
 * The separator evidence for the whole paste, decided once. Every cell of every line is a vote, which
 * is what makes `Rp 1.000` on one line and `Rp 1.250.000,50` on another read the same way.
 */
function styleOf(text: string): NumberStyle {
  return sheetNumberStyle(text.split(/\r?\n/).map((line) => line.split(/[|:=]/).map((cell) => cell.trim())));
}

/** Every row, fact and note the figures text holds, with nothing renamed and no amount re-read. */
function readFiguresBody(text: string): FiguresTextRead {
  const style = styleOf(text);
  const rows: FigureRow[] = [];
  const facts: StatedFigure[] = [];
  const notes: string[] = [];
  const unread: string[] = [];
  let block: Block | null = null;
  let seenTable = false;
  let order = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") {
      continue;
    }
    if (SHEET_LINE.test(line)) {
      block = null;
      continue;
    }
    if (NOTE_LINE.test(line)) {
      notes.push(line.replace(NOTE_LINE, ""));
      continue;
    }
    if (line.includes("|")) {
      const cells = line.split("|").map((cell) => cell.trim());
      // A row under an open block is a row, not a new header: only a line that fills none of the
      // block's columns can be the start of the sheet's next table.
      const read = block ? wideRows(cells, block, order, style) : [];
      if (read.length > 0) {
        seenTable = true;
        rows.push(...read);
        order += 1;
        continue;
      }
      const header = headerBlock(cells, style);
      if (header) {
        block = header;
        seenTable = true;
        continue;
      }
      const compact = compactRows(cells, order, style);
      if (compact.length === 0) {
        unread.push(line);
        continue;
      }
      seenTable = true;
      rows.push(...compact);
      order += 1;
      continue;
    }
    const narrow = narrowRow(line, order, style);
    if (!narrow) {
      unread.push(line);
      continue;
    }
    rows.push(narrow);
    order += 1;
    // Above the first table these are the sheet's own title-band figures ("Saldo awal: 1.200.000").
    // They are rows like any other; the list is what the confirm step shows them under.
    if (!seenTable) {
      facts.push({ label: narrow.label, value: narrow.amount, currency: narrow.currency });
    }
  }
  return { rows, facts, notes, unread, deterministic: rows.length > 0 && unread.length === 0 };
}

/**
 * The sheet reader, and — only when that reader found nothing — a typed sentence rewritten as
 * `Label: amount` lines. A table that already produced rows is never rewritten.
 */
export function readFiguresText(text: string): FiguresTextRead {
  const read = readFiguresBody(text);
  if (read.rows.length > 0) {
    return read;
  }
  const lines = labeledAmountLines(text);
  if (!lines) {
    return read;
  }
  const again = readFiguresBody(lines);
  return again.rows.length > 0 ? again : read;
}
