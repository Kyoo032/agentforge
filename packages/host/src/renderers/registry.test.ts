import { describe, expect, it } from "vitest";
import { ApiError } from "@agentforge/core";
import { DEFAULT_REPORT_FORMAT, PDF_UNAVAILABLE_CODE, renderReport } from "./registry";
import { REPORT_FORMATS, REPORT_MIME, isReportFormat } from "./types";
import { bareReport, sampleReport } from "./__fixtures__/report";

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (error) {
    return error as ApiError;
  }
  throw new Error("expected the render to fail");
}

describe("isReportFormat", () => {
  it("accepts the five formats the app can render and nothing else", () => {
    expect(REPORT_FORMATS).toEqual(["xlsx", "pptx", "docx", "md", "pdf"]);
    expect(isReportFormat("xlsx")).toBe(true);
    expect(isReportFormat("csv")).toBe(false);
    expect(isReportFormat(null)).toBe(false);
  });
});

describe("renderReport", () => {
  it("defaults to the workbook", async () => {
    expect(DEFAULT_REPORT_FORMAT).toBe("xlsx");
    const file = await renderReport(sampleReport());
    expect(file.mime).toBe(REPORT_MIME.xlsx);
  });

  for (const format of ["xlsx", "pptx", "docx", "md"] as const) {
    it(`renders non-empty ${format} bytes with the right mime and extension`, async () => {
      const file = await renderReport(sampleReport(), format);
      expect(file.bytes.length).toBeGreaterThan(0);
      expect(file.mime).toBe(REPORT_MIME[format]);
      expect(file.filename.endsWith(`.${format}`)).toBe(true);
    });
  }

  it("writes the report's notes, tables and flags into the markdown", async () => {
    const file = await renderReport(sampleReport(), "md");
    const text = Buffer.from(file.bytes).toString("utf8");
    expect(text).toContain("# Margins held while cash thinned");
    expect(text).toContain("## Revenue grew");
    expect(text).toContain("Totals by period");
    expect(text).toContain("Net margin 2026: -4%");
  });

  it("renders the document through the existing brief builder", async () => {
    const file = await renderReport(sampleReport(), "docx");
    expect(file.bytes[0]).toBe(0x50);
    expect(file.bytes[1]).toBe(0x4b);
  });

  it("answers a PDF request with a typed, readable error instead of a broken file", async () => {
    const error = await failure(renderReport(sampleReport(), "pdf"));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe(PDF_UNAVAILABLE_CODE);
    expect(error.status).toBe(501);
    expect(error.message).toMatch(/PDF/);
  });

  it("refuses a format that is not in the registry", async () => {
    const error = await failure(renderReport(sampleReport(), "csv" as never));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
  });

  it("renders every format for a report with nothing but prose", async () => {
    for (const format of ["xlsx", "pptx", "docx", "md"] as const) {
      const file = await renderReport(bareReport(), format);
      expect(file.bytes.length).toBeGreaterThan(0);
    }
  });
});
