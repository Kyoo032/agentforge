/** Shared Markdown table serializer used by every artifact serializer. */

export type CellValue = string | number | boolean | null | undefined;

const MAX_SIGNIFICANT_DECIMALS = 4;

export function formatCellNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (Number.isInteger(value)) {
    return String(value);
  }
  return String(Number(value.toFixed(MAX_SIGNIFICANT_DECIMALS)));
}

export function escapeMarkdownCell(value: CellValue): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "number" ? formatCellNumber(value) : String(value);
  return text.replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
}

/** Render a GFM pipe table. Rows shorter than `columns` are padded; longer rows are truncated. */
export function markdownTable(columns: readonly string[], rows: ReadonlyArray<ReadonlyArray<CellValue>>): string {
  if (columns.length === 0) {
    return "";
  }
  const header = `| ${columns.map(escapeMarkdownCell).join(" | ")} |`;
  const divider = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => {
    const cells = columns.map((_, index) => escapeMarkdownCell(row[index]));
    return `| ${cells.join(" | ")} |`;
  });
  return [header, divider, ...body].join("\n");
}
