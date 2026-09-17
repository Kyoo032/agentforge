import type { FinanceBrief } from "@agentforge/core/artifacts";
import { ASSUMPTIONS_HEADING, type FinanceReport } from "@agentforge/core/finance";
import { buildFinanceDocx } from "../finance-docx";
import { REPORT_MIME, type RenderOptions, type RenderedFile, type ReportRenderer } from "./types";

/** Body text the schema still accepts when a note came back empty. */
const EMPTY_BODY = "-";

/**
 * A report that never was a brief - an export driven by an artifact id, say - still has to reach
 * the one DOCX builder. Its notes become the sections and its tables the computed appendix.
 */
function briefFromReport(report: FinanceReport): FinanceBrief {
  const sections = report.notes
    .filter((note) => note.heading !== ASSUMPTIONS_HEADING)
    .map((note) => ({ heading: note.heading, body: note.body.trim() || EMPTY_BODY, tables: [], metrics: [] }));
  const assumptions = report.notes
    .filter((note) => note.heading === ASSUMPTIONS_HEADING)
    .flatMap((note) => note.body.split("\n").filter((line) => line.trim() !== ""));
  return {
    title: report.title,
    sections: sections.length > 0 ? sections : [{ heading: report.title, body: EMPTY_BODY, tables: [], metrics: [] }],
    assumptions,
    computed: {
      metrics: [],
      tables: report.tables.map((table) => ({
        name: table.title,
        columns: [...table.columns],
        rows: table.rows.map((row) => [...row]),
      })),
    },
  };
}

/** Thin adapter: the existing brief builder writes the file, unchanged. */
export const renderDocx: ReportRenderer = async (
  report: FinanceReport,
  options?: RenderOptions,
): Promise<RenderedFile> => {
  const { buffer, filename } = await buildFinanceDocx(options?.brief ?? briefFromReport(report), options?.locale);
  return { bytes: new Uint8Array(buffer), mime: REPORT_MIME.docx, filename };
};
