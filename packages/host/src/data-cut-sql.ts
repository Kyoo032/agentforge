import type { PlannedCut } from "@agentforge/core/data";
import { DATASET_TABLE, quoteIdentifier } from "./sql-guard";

export type CutSql = { sql: string };

/** One read-only SELECT for a cut the column types allowed. Identifiers are already safe names. */
export function sqlForCut(cut: PlannedCut, identifierFor: (name: string) => string): CutSql {
  const quote = (name: string) => quoteIdentifier(identifierFor(name));
  if (cut.kind === "rows") {
    return { sql: `SELECT COUNT(*) AS rows FROM ${DATASET_TABLE}` };
  }
  if (cut.kind === "blanks") {
    const pieces = cut.columns.map(
      (name, index) => `SUM(CASE WHEN ${quote(name)} IS NULL THEN 1 ELSE 0 END) AS b${index}`,
    );
    return { sql: `SELECT COUNT(*) AS rows, ${pieces.join(", ")} FROM ${DATASET_TABLE}` };
  }
  if (cut.kind === "split") {
    const group = quote(cut.columns[0] ?? "");
    return {
      sql: `SELECT ${group} AS group_key, COUNT(*) AS rows FROM ${DATASET_TABLE} GROUP BY ${group} ORDER BY rows DESC LIMIT 50`,
    };
  }
  const group = quote(cut.columns[0] ?? "");
  const measure = quote(cut.columns[1] ?? "");
  const fn = cut.aggregate === "avg" ? "AVG" : "SUM";
  const alias = cut.aggregate === "avg" ? "average" : "total";
  const order = cut.kind === "over_time" ? group : `${alias} DESC`;
  return {
    sql: `SELECT ${group} AS group_key, ${fn}(${measure}) AS ${alias} FROM ${DATASET_TABLE} GROUP BY ${group} ORDER BY ${order} LIMIT 50`,
  };
}
