import { ApiError } from "@agentforge/core";
import type { FinanceReport } from "@agentforge/core/finance";
import { renderDocx } from "./docx";
import { renderMd } from "./md";
import { renderPptx } from "./pptx";
import { renderXlsx } from "./xlsx";
import { isReportFormat, type RenderOptions, type RenderedFile, type ReportFormat, type ReportRenderer } from "./types";

/** Finance leaves as a workbook unless the reader picks something else. */
export const DEFAULT_REPORT_FORMAT: ReportFormat = "xlsx";

export const PDF_UNAVAILABLE_CODE = "format_unavailable";
export const PDF_UNAVAILABLE_STATUS = 501;
export const PDF_UNAVAILABLE_MESSAGE =
  "PDF export is not ready yet. Export as Excel, PowerPoint, Word or Markdown for now.";

/** Registered so the picker can offer it and get one clear answer, not a broken file. */
const renderPdf: ReportRenderer = async () => {
  throw new ApiError(PDF_UNAVAILABLE_CODE, PDF_UNAVAILABLE_MESSAGE, PDF_UNAVAILABLE_STATUS);
};

const RENDERERS: Record<ReportFormat, ReportRenderer> = {
  xlsx: renderXlsx,
  pptx: renderPptx,
  docx: renderDocx,
  md: renderMd,
  pdf: renderPdf,
};

/** One report, one format, one file. The only entry point a route should use. */
export async function renderReport(
  report: FinanceReport,
  format: ReportFormat = DEFAULT_REPORT_FORMAT,
  options?: RenderOptions,
): Promise<RenderedFile> {
  if (!isReportFormat(format)) {
    throw new ApiError("invalid_request", `Unknown export format: ${String(format)}`, 400);
  }
  return RENDERERS[format](report, options);
}
