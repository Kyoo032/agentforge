import type { FinanceBrief } from "@agentforge/core/artifacts";
import type { FinanceReport } from "@agentforge/core/finance";

/** Every file type the app can hand a finance report to. */
export const REPORT_FORMATS = ["xlsx", "pptx", "docx", "md", "pdf"] as const;

export type ReportFormat = (typeof REPORT_FORMATS)[number];

export type RenderedFile = {
  bytes: Uint8Array;
  mime: string;
  filename: string;
  /**
   * What the renderer could not write faithfully — today, formula cells the report left without a
   * value. The file is still produced; the warning is how the task that built the report finds out
   * which of its cells were empty.
   */
  warnings?: readonly string[];
};

/**
 * Extras a renderer may use when it has them. `brief` lets the document renderer delegate to the
 * existing builder, so a brief exported as .docx is byte-for-byte what /finance/docx already writes.
 */
export type RenderOptions = {
  brief?: FinanceBrief;
  locale?: string;
};

export type ReportRenderer = (report: FinanceReport, options?: RenderOptions) => Promise<RenderedFile>;

export const REPORT_MIME: Record<ReportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  md: "text/markdown; charset=utf-8",
  pdf: "application/pdf",
};

export function isReportFormat(value: unknown): value is ReportFormat {
  return typeof value === "string" && (REPORT_FORMATS as readonly string[]).includes(value);
}
