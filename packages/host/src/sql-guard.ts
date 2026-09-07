import { ApiError } from "@agentforge/core";
import type { ColumnType } from "@agentforge/core/tabular";

/** Table name every dataset is loaded into; the model only ever sees this one. */
export const DATASET_TABLE = "data";

const FORBIDDEN_KEYWORDS =
  /\b(attach|detach|pragma\w*|insert|update|delete|drop|create|alter|replace|vacuum|reindex|begin|commit|rollback|savepoint|release|load_extension|readfile|writefile|zipfile|fsdir|randomblob|zeroblob|recursive|sqlite_master|sqlite_schema|sqlite_temp_master|sqlite_temp_schema)\b/i;
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

function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""');
}

/**
 * Accept one read-only statement (SELECT or WITH … SELECT), no comments, no
 * second statement, no write / schema / extension keywords outside string literals.
 */
export function assertReadOnlySql(input: string): string {
  const trimmed = input.trim().replace(/;+\s*$/, "");
  if (!trimmed) {
    throw new ApiError("invalid_sql", "SQL is empty", 400);
  }
  const stripped = stripLiterals(trimmed);
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
