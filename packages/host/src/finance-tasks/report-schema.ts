/**
 * `FinanceReport`, validated at the boundary.
 *
 * Every task exports through the same renderers, so the studio may post the report it is showing
 * rather than a brief — that is the only way a cash-flow or ratio result can reach the workbook.
 * A posted report is untrusted input: it is shaped by this schema, capped by size, and its cells
 * are primitives only, so nothing a renderer writes can come from an unchecked object.
 */
import { z } from "zod";
import { ApiError } from "@agentforge/core";
import { REPORT_CHART_KINDS, REPORT_FLAG_LEVELS, type FinanceReport } from "@agentforge/core/finance";

/** A posted report past this size is refused rather than rendered. Matches the artifact meta cap. */
export const FINANCE_REPORT_MAX_BYTES = 256 * 1024;

const TITLE_MAX = 400;
const TEXT_MAX = 20_000;
const CELL_MAX = 2_000;
const LIST_MAX = 200;
const ROW_MAX = 5_000;
const COLUMN_MAX = 100;

const cellSchema = z.union([z.string().max(CELL_MAX), z.number().finite(), z.boolean(), z.null()]);

const kpiSchema = z.object({
  label: z.string().max(TITLE_MAX),
  value: z.union([z.number().finite(), z.string().max(CELL_MAX), z.null()]),
  unit: z.string().max(TITLE_MAX).optional(),
  flag: z.enum(REPORT_FLAG_LEVELS).optional(),
});

const tableSchema = z.object({
  id: z.string().max(TITLE_MAX),
  title: z.string().max(TITLE_MAX),
  columns: z.array(z.string().max(TITLE_MAX)).max(COLUMN_MAX),
  rows: z.array(z.array(cellSchema).max(COLUMN_MAX)).max(ROW_MAX),
  formulas: z
    .array(z.array(z.string().max(CELL_MAX).nullable()).max(COLUMN_MAX))
    .max(ROW_MAX)
    .optional(),
});

const chartSchema = z.object({
  id: z.string().max(TITLE_MAX),
  title: z.string().max(TITLE_MAX),
  kind: z.enum(REPORT_CHART_KINDS),
  categories: z.array(z.string().max(TITLE_MAX)).max(ROW_MAX),
  series: z
    .array(
      z.object({
        name: z.string().max(TITLE_MAX),
        values: z.array(z.union([z.number().finite(), z.null()])).max(ROW_MAX),
      }),
    )
    .max(LIST_MAX),
  note: z.string().max(TEXT_MAX).optional(),
});

export const financeReportSchema = z.object({
  task: z.string().min(1).max(TITLE_MAX),
  title: z.string().min(1).max(TITLE_MAX),
  subtitle: z.string().max(TITLE_MAX).optional(),
  locale: z.enum(["id", "en"]),
  currency: z.string().max(TITLE_MAX).optional(),
  summary: z.array(kpiSchema).max(LIST_MAX),
  tables: z.array(tableSchema).max(LIST_MAX),
  charts: z.array(chartSchema).max(LIST_MAX),
  flags: z.array(z.object({ level: z.enum(REPORT_FLAG_LEVELS), text: z.string().max(TEXT_MAX) })).max(LIST_MAX),
  notes: z.array(z.object({ heading: z.string().max(TITLE_MAX), body: z.string().max(TEXT_MAX) })).max(LIST_MAX),
});

/** A posted report, refused with one clear message when it is malformed or oversized. */
export function readPostedFinanceReport(value: unknown): FinanceReport {
  if (Buffer.byteLength(JSON.stringify(value ?? null), "utf8") > FINANCE_REPORT_MAX_BYTES) {
    throw new ApiError("invalid_request", `report is over the ${FINANCE_REPORT_MAX_BYTES} byte cap`, 413);
  }
  const parsed = financeReportSchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError("invalid_request", "report is malformed", 400);
  }
  return parsed.data;
}
