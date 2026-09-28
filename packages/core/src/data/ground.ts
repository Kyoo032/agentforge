export type GroundCell = string | number | boolean | null;

export type GroundTable = {
  columns: string[];
  rows: GroundCell[][];
};

const NUMBER_RE = /[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?/g;
const SENTENCE_RE = /[^.!?\n]+[.!?]?/g;

/** Numeric tokens in prose. SQL and column identifiers are the caller's problem to leave out. */
export function numbersInText(text: string): string[] {
  return [...text.matchAll(NUMBER_RE)].map((match) => match[0]);
}

function close(left: number, right: number): boolean {
  const scale = Math.max(1, Math.abs(left), Math.abs(right));
  return Math.abs(left - right) <= 1e-9 * scale;
}

function canonical(raw: string): string {
  return raw.replace(/,/g, "").replace(/^\+/, "");
}

function cellHolds(cell: GroundCell, raw: string, value: number, percent: boolean): boolean {
  if (cell === null || cell === undefined) {
    return false;
  }
  const token = canonical(raw);
  if (typeof cell === "number") {
    return close(cell, value) || (percent && close(cell * 100, value));
  }
  if (typeof cell === "boolean") {
    return (cell && value === 1) || (!cell && value === 0);
  }
  const text = cell.trim();
  if (text === raw || text === token) {
    return true;
  }
  if (/^\d{4}$/.test(token) && (text.startsWith(`${token}-`) || text.startsWith(`${token}/`))) {
    return true;
  }
  if (/^\d{2}$/.test(token) && new RegExp(`(?:^|\\D)${token}(?:\\D|$)`).test(text)) {
    return true;
  }
  return false;
}

/** A prose number is allowed only when some cell in the query results is that number. */
export function numberIsGrounded(raw: string, tables: readonly GroundTable[]): boolean {
  const percent = raw.endsWith("%");
  const token = percent ? raw.slice(0, -1) : raw;
  const value = Number(canonical(token));
  if (!Number.isFinite(value)) {
    return true;
  }
  for (const table of tables) {
    for (const row of table.rows) {
      for (const cell of row) {
        if (cellHolds(cell, token, value, percent)) {
          return true;
        }
      }
    }
  }
  return false;
}

export function ungroundedNumbers(text: string, tables: readonly GroundTable[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(NUMBER_RE)) {
    const raw = match[0];
    if (seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    if (!numberIsGrounded(raw, tables)) {
      out.push(raw);
    }
  }
  return out;
}

/** Drop sentences that state a number the queries did not return. */
export function stripUngroundedSentences(text: string, tables: readonly GroundTable[]): string {
  const parts =
    text
      .match(SENTENCE_RE)
      ?.map((part) => part.trim())
      .filter(Boolean) ?? [];
  return parts.filter((part) => ungroundedNumbers(part, tables).length === 0).join(" ");
}
