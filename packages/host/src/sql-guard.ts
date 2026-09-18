import { ApiError } from "@agentforge/core";
import type { ColumnType } from "@agentforge/core/tabular";

/** Table name every dataset is loaded into; the model only ever sees this one. */
export const DATASET_TABLE = "data";

const FORBIDDEN_KEYWORDS =
  /\b(attach|detach|pragma\w*|insert|update|delete|drop|create|alter|replace|vacuum|reindex|begin|commit|rollback|savepoint|release|load_extension|readfile|writefile|zipfile|fsdir|randomblob|zeroblob|recursive|sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema|sqlite_dbpage|dbstat)\b/i;
/** Table references to `data`: FROM data, JOIN data, ", data". */
const DATA_REFERENCE = /(\bfrom\s+|\bjoin\s+|,\s*)data\b/gi;
const JOIN_PREDICATE = /\b(on|where|using)\b/i;
const RESERVED = new Set([
  "select",
  "from",
  "where",
  "group",
  "order",
  "by",
  "limit",
  "table",
  "index",
  "join",
  "on",
  "as",
  "and",
  "or",
  "not",
  "null",
  "in",
  "is",
  "case",
  "when",
  "then",
  "else",
  "end",
  "union",
  "all",
  "distinct",
  "having",
  "with",
  "data",
  "rowid",
]);

/** A newline or a NUL inside a quoted identifier: never a real column name, always an evasion. */
const IDENTIFIER_CONTROL: ReadonlySet<number> = new Set([0x00, 0x0a, 0x0d]);

/** Spelled by code point: a control character in the source of a regex is itself a lint error. */
function hasControlCharacter(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    if (IDENTIFIER_CONTROL.has(text.charCodeAt(index))) {
      return true;
    }
  }
  return false;
}

/**
 * Index just past the quote that closes the run starting at `start`, or -1 when it never closes.
 * A doubled quote (`''`, `""`) escapes itself, exactly as SQLite reads it.
 */
function endOfQuoted(sql: string, start: number, quote: string): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] !== quote) {
      index += 1;
    } else if (sql[index + 1] === quote) {
      index += 2;
    } else {
      return index + 1;
    }
  }
  return -1;
}

/**
 * One pass over the statement, splitting it the way SQLite's tokenizer does.
 *
 * A single-quoted run is a string literal: its content is data, so it collapses to `''` and the
 * deny-list never sees the words inside it. A double-quoted run is an *identifier*, not data:
 * `SELECT * FROM "sqlite_master"` reaches the schema table exactly as the bare name does, so the
 * text stays in place for the deny-list to read. (This is why the two cannot share one regex: the
 * old version stripped both, and every blocked name had a quoted spelling that walked straight
 * past the guard.)
 *
 * Scanning in one pass also settles the mixed case. In `"a'", … 'x'` the `'` sits inside an
 * identifier and opens nothing; a pass that looked for quotes independently would pair it with a
 * later one and mask the span between them — keyword and all.
 */
function maskLiterals(sql: string): string {
  const parts: string[] = [];
  let index = 0;
  let plain = 0;
  while (index < sql.length) {
    const char = sql[index];
    if (char !== "'" && char !== '"') {
      index += 1;
      continue;
    }
    const end = endOfQuoted(sql, index, char);
    if (end < 0) {
      const what = char === "'" ? "string literal" : "quoted identifier";
      throw new ApiError("invalid_sql", `Unterminated ${what} in the query`, 400);
    }
    const quoted = sql.slice(index, end);
    if (char === '"' && hasControlCharacter(quoted)) {
      throw new ApiError("invalid_sql", "A quoted identifier may not contain a newline or a NUL", 400);
    }
    parts.push(sql.slice(plain, index), char === "'" ? "''" : quoted);
    index = end;
    plain = end;
  }
  parts.push(sql.slice(plain));
  return parts.join("");
}

/**
 * Accept one read-only statement (SELECT or WITH … SELECT), no comments, no
 * second statement, no write / schema / extension keywords outside string literals.
 *
 * A blocked name inside a double-quoted identifier is rejected too, so a quoted spelling buys
 * nothing. The cost is that a column literally named `"my attach date"` is refused; every
 * identifier this app generates is `[a-z0-9_]` (`toSqlIdentifier`), so nothing it builds can hit it.
 */
export function assertReadOnlySql(input: string): string {
  const trimmed = input.trim().replace(/;+\s*$/, "");
  if (!trimmed) {
    throw new ApiError("invalid_sql", "SQL is empty", 400);
  }
  const stripped = maskLiterals(trimmed);
  if (stripped.includes(";")) {
    throw new ApiError("invalid_sql", "Only one statement is allowed", 400);
  }
  if (/--|\/\*/.test(stripped)) {
    throw new ApiError("invalid_sql", "SQL comments are not allowed", 400);
  }
  if (!/^(select|with)\b/i.test(stripped)) {
    throw new ApiError("invalid_sql", "Only SELECT queries are allowed", 400);
  }
  const forbidden = stripped.match(FORBIDDEN_KEYWORDS);
  if (forbidden) {
    throw new ApiError("invalid_sql", `Keyword not allowed in a read-only query: ${forbidden[1]?.toUpperCase()}`, 400);
  }
  const references = stripped.match(DATA_REFERENCE)?.length ?? 0;
  if (references > 1 && !JOIN_PREDICATE.test(stripped)) {
    throw new ApiError("invalid_sql", "Joins of the table with itself need an ON or WHERE predicate", 400);
  }
  return trimmed;
}

/** Stable SQL identifier for a column header: lowercase, `_` for anything else, unique, never reserved. */
export function toSqlIdentifier(name: string, taken: readonly string[]): string {
  const base = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  let candidate = base && !/^\d/.test(base) && !RESERVED.has(base) ? base : `c_${base || "col"}`;
  let suffix = 2;
  while (taken.includes(candidate)) {
    candidate = `${base || "c_col"}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function sqlTypeFor(type: ColumnType): "REAL" | "INTEGER" | "TEXT" {
  if (type === "number") {
    return "REAL";
  }
  if (type === "boolean") {
    return "INTEGER";
  }
  return "TEXT";
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

/**
 * The character every `LIKE ? ESCAPE '…'` in this codebase uses. SQLite has no default escape
 * character for LIKE, so a pattern is only literal when the statement names one.
 */
export const LIKE_ESCAPE = "\\";

/**
 * Make a request-supplied value literal inside a LIKE pattern: `%` and `_` are wildcards, and the
 * escape character has to be escaped first so an already-escaped wildcard is not un-escaped.
 *
 * The value still goes in as a bind parameter — this is not about SQL injection, it is about a `%`
 * in an id silently widening a prefilter (or a DELETE's shortlist) to rows it was never meant to
 * see. The statement must carry `ESCAPE '\'`; use `LIKE_ESCAPE` so the two never drift.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `${LIKE_ESCAPE}${character}`);
}
