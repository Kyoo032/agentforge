/**
 * Reading GFM pipe tables back out of converted Markdown, and the plain prose around them.
 *
 * A converted workbook, deck or report is Markdown, but Finance wants rows: the same `string[][]`
 * shape a spreadsheet import produces, so a document table can go through `tableToFiguresText`
 * unchanged. This parser is deliberately small and total — it never throws, and anything that is not
 * a well-formed table stays prose.
 *
 * What counts as a table: a header line of pipe cells, an alignment line directly under it
 * (`---`, `:---`, `---:`, `:---:`), then body lines for as long as they keep the pipe shape. An
 * escaped pipe (`\|`) is a character inside a cell, never a separator.
 */
import {
  FILE_EXTRACT_MAX_CELL_CHARS,
  FILE_EXTRACT_MAX_TABLES,
  FILE_EXTRACT_MAX_TABLE_COLS,
  FILE_EXTRACT_MAX_TABLE_ROWS,
} from "./limits";

/** One table lifted out of a document. `title` is the nearest heading above it, when there is one. */
export type ExtractedTable = { readonly title?: string; readonly rows: ReadonlyArray<ReadonlyArray<string>> };

const HEADING = /^(#{1,6})\s+(.*)$/;
const ALIGNMENT_CELL = /^:?-+:?$/;
/** Anything below the space, plus DEL: converter junk that must never reach a prompt or the screen. */
const LAST_CONTROL_CODE = 0x1f;
const DELETE_CODE = 0x7f;

function isControlChar(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return code <= LAST_CONTROL_CODE || code === DELETE_CODE;
}

function isTableLine(line: string): boolean {
  return line.trim().startsWith("|") || line.includes("|");
}

/** Split on unescaped pipes only, then unescape. `a \| b | c` is two cells, not three. */
function splitCells(line: string): string[] {
  const trimmed = line.trim();
  const inner = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let current = "";
  for (let index = 0; index < inner.length; index += 1) {
    const char = inner[index];
    if (char === "\\" && inner[index + 1] === "|") {
      current += "|";
      index += 1;
    } else if (char === "|") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * Emphasis a converter put around a whole cell. A Word table writes its header row and its subtotal
 * rows in bold, and the converter spells that `**2024**` — which is the same cell, in bold, and not
 * a cell whose text is asterisks. Left on, the year stops reading as a period and a two-year
 * statement collapses into one undated column.
 */
const WRAPPING_EMPHASIS = /^\s*(\*\*\*|\*\*|__|[*_`])([\s\S]*?)\1\s*$/;

function withoutEmphasis(text: string): string {
  let current = text.trim();
  for (let pass = 0; pass < 3; pass += 1) {
    const match = WRAPPING_EMPHASIS.exec(current);
    if (!match) {
      return current;
    }
    current = (match[2] ?? "").trim();
  }
  return current;
}

/** Cells are untrusted text: control characters out, whitespace collapsed, emphasis off, length capped. */
function cleanCell(raw: string): string {
  const text = withoutEmphasis(
    [...raw]
      .map((char) => (isControlChar(char) ? " " : char))
      .join("")
      .replace(/\s+/g, " "),
  );
  return text.length > FILE_EXTRACT_MAX_CELL_CHARS ? text.slice(0, FILE_EXTRACT_MAX_CELL_CHARS).trim() : text;
}

function isAlignmentRow(line: string): boolean {
  if (!isTableLine(line)) {
    return false;
  }
  const cells = splitCells(line).map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => ALIGNMENT_CELL.test(cell));
}

function padded(cells: ReadonlyArray<string>, width: number): string[] {
  return [...cells.slice(0, width), ...Array.from({ length: Math.max(0, width - cells.length) }, () => "")];
}

/** A leading row of nothing but blanks is a converter artefact (CSV with no header), not data. */
function withoutBlankHeader(rows: ReadonlyArray<ReadonlyArray<string>>): string[][] {
  const first = rows[0];
  const drop = first !== undefined && rows.length > 1 && first.every((cell) => cell === "");
  return (drop ? rows.slice(1) : rows).map((row) => [...row]);
}

type Block = { readonly table: ExtractedTable; readonly from: number; readonly to: number };

/** Reads one table starting at `start`, or null when the two lines there are not a table head. */
function readBlock(lines: ReadonlyArray<string>, start: number, title: string | undefined): Block | null {
  const header = lines[start];
  const alignment = lines[start + 1];
  if (header === undefined || alignment === undefined || !isTableLine(header) || !isAlignmentRow(alignment)) {
    return null;
  }
  const width = Math.min(splitCells(header).length, FILE_EXTRACT_MAX_TABLE_COLS);
  const collected: string[][] = [padded(splitCells(header).map(cleanCell), width)];
  let index = start + 2;
  while (index < lines.length && isTableLine(lines[index] ?? "") && collected.length < FILE_EXTRACT_MAX_TABLE_ROWS) {
    collected.push(padded(splitCells(lines[index] ?? "").map(cleanCell), width));
    index += 1;
  }
  const rows = withoutBlankHeader(collected).filter((row) => row.some((cell) => cell !== ""));
  if (rows.length === 0) {
    return null;
  }
  return { table: title === undefined ? { rows } : { title, rows }, from: start, to: index };
}

/**
 * Every pipe table in a Markdown document, in order, each titled by the nearest heading above it.
 * Tables past {@link FILE_EXTRACT_MAX_TABLES} are dropped rather than materialised.
 */
export function parseMarkdownTables(markdown: string): ExtractedTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: ExtractedTable[] = [];
  let heading: string | undefined;
  let index = 0;
  while (index < lines.length && tables.length < FILE_EXTRACT_MAX_TABLES) {
    const headingMatch = HEADING.exec(lines[index] ?? "");
    if (headingMatch) {
      heading = cleanCell(headingMatch[2] ?? "") || undefined;
      index += 1;
      continue;
    }
    const block = readBlock(lines, index, heading);
    if (block) {
      tables.push(block.table);
      index = block.to;
      continue;
    }
    index += 1;
  }
  return tables;
}

const EMPHASIS = /(\*\*|__|\*|_|`)/g;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** One Markdown line as the plain text behind it: no heading hashes, quote marks, links or emphasis. */
function plainLine(line: string): string {
  return line
    .replace(HEADING, "$2")
    .replace(/^\s*>\s?/, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(EMPHASIS, "")
    .trimEnd();
}

type TextOptions = {
  /** Drop table blocks entirely — what Finance wants when the tables are handled as sheets. */
  readonly withoutTables?: boolean;
};

/**
 * The document as plain text. Table rows keep their `a | b` shape (that is how the figures text and
 * the knowledge index have always read a table) unless the caller asks for prose only.
 */
export function markdownToText(markdown: string, options: TextOptions = {}): string {
  const lines = markdown.split(/\r?\n/);
  const kept: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const block = readBlock(lines, index, undefined);
    if (block) {
      if (!options.withoutTables) {
        kept.push(...block.table.rows.map((row) => row.join(" | ")));
      }
      index = block.to;
      continue;
    }
    kept.push(plainLine(lines[index] ?? ""));
    index += 1;
  }
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
