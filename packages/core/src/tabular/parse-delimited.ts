import type { TabularTable } from "./types";

export const DELIMITERS = [",", ";", "\t", "|"] as const;

const DEFAULT_DELIMITER = DELIMITERS[0];
const SNIFF_LINES = 20;
/** Hard cap on delimited text handed to the parser (chars). Callers map the RangeError to 413. */
export const MAX_TABULAR_CHARS = 25_000_000;
const BOM = String.fromCharCode(0xfeff);
const LINE_BREAK = /\r\n|\r|\n/;

function hasContent(row: readonly string[]): boolean {
  return row.some((cell) => cell.trim() !== "");
}

/**
 * Splits text into RFC-4180 records. Quoted fields may contain the delimiter, quotes (doubled) and newlines.
 * `maxRecords` stops tokenizing once that many non-empty records exist, so a capped read never holds the whole input.
 */
export function tokenize(text: string, delimiter: string, maxRecords?: number): string[][] {
  const limit = maxRecords ?? Number.POSITIVE_INFINITY;
  const records: string[][] = [];
  let kept = 0;
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let pending = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] as string;
    pending = true;
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      records.push(row);
      kept += hasContent(row) ? 1 : 0;
      row = [];
      field = "";
      pending = false;
      if (kept >= limit) {
        return records;
      }
    } else {
      field += ch;
    }
  }
  return pending ? [...records, [...row, field]] : records;
}

function modeOf(values: readonly number[]): number {
  const counts = values.reduce((acc, value) => acc.set(value, (acc.get(value) ?? 0) + 1), new Map<number, number>());
  return [...counts.entries()].reduce((best, entry) => (entry[1] > best[1] ? entry : best), [0, 0])[0];
}

/** Score = number of sampled records whose field count matches the mode; 0 when the mode implies no delimiter. */
function scoreDelimiter(sample: string, delimiter: string, truncated: boolean): number {
  const records = tokenize(sample, delimiter);
  const usable = truncated ? records.slice(0, -1) : records;
  const counts = usable.map((record) => record.length - 1);
  const mode = modeOf(counts);
  return mode > 0 ? counts.filter((count) => count === mode).length : 0;
}

export function sniffDelimiter(text: string): string {
  const lines = stripBom(text)
    .split(LINE_BREAK)
    .filter((line) => line.trim() !== "");
  const truncated = lines.length > SNIFF_LINES;
  const sample = lines.slice(0, SNIFF_LINES).join("\n");
  const best = DELIMITERS.reduce<{ delimiter: string; score: number }>(
    (acc, delimiter) => {
      const score = scoreDelimiter(sample, delimiter, truncated);
      return score > acc.score ? { delimiter, score } : acc;
    },
    { delimiter: DEFAULT_DELIMITER, score: 0 },
  );
  return best.delimiter;
}

function uniqueName(base: string, taken: readonly string[]): string {
  if (!taken.includes(base)) {
    return base;
  }
  let suffix = 2;
  while (taken.includes(`${base}_${suffix}`)) {
    suffix += 1;
  }
  return `${base}_${suffix}`;
}

function normalizeHeaders(raw: readonly string[]): string[] {
  const names: string[] = [];
  raw.forEach((cell, index) => {
    names.push(uniqueName(cell === "" ? `column_${index + 1}` : cell, names));
  });
  return names;
}

function fitRow(row: readonly string[], width: number): string[] {
  const cells = row.slice(0, width);
  return cells.length === width ? cells : [...cells, ...Array.from({ length: width - cells.length }, () => "")];
}

/**
 * Builds a table from raw string rows: trims cells, drops fully empty rows, takes the first row as headers
 * (empty → `column_<n>`, duplicates → `_2`, `_3`, …), pads/truncates the rest to the header width.
 * Returns null without a header row or at least one data row.
 */
export function tableFromRows(
  rows: ReadonlyArray<ReadonlyArray<string>>,
  delimiter: string,
  maxRows?: number,
): TabularTable | null {
  const nonEmpty = rows.map((row) => row.map((cell) => cell.trim())).filter((row) => row.some((cell) => cell !== ""));
  const [headerRow, ...body] = nonEmpty;
  if (!headerRow || body.length === 0) {
    return null;
  }
  const headers = normalizeHeaders(headerRow);
  const width = headers.length;
  const ragged = body.some((row) => row.length !== width);
  const limited = maxRows === undefined ? body : body.slice(0, Math.max(0, maxRows));
  return { headers, rows: limited.map((row) => fitRow(row, width)), delimiter, ragged };
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

export type ParseDelimitedOptions = { delimiter?: string; maxRows?: number; maxChars?: number };

/** Throws a RangeError when the text is over `maxChars` (default MAX_TABULAR_CHARS) instead of parsing it. */
export function parseDelimited(text: string, options?: ParseDelimitedOptions): TabularTable | null {
  const maxChars = options?.maxChars ?? MAX_TABULAR_CHARS;
  if (text.length > maxChars) {
    throw new RangeError(`Table text exceeds ${maxChars.toLocaleString()} characters`);
  }
  const body = stripBom(text);
  const delimiter = options?.delimiter ?? sniffDelimiter(body);
  const maxRecords = options?.maxRows === undefined ? undefined : Math.max(0, options.maxRows) + 1;
  return tableFromRows(tokenize(body, delimiter, maxRecords), delimiter, options?.maxRows);
}
