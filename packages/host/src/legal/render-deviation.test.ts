import { listXlsxSheets, parseXlsx } from "@agentforge/core/tabular";
import { describe, expect, it } from "vitest";
import { DEVIATIONS_SHEET, DEVIATION_COLUMNS, SUMMARY_SHEET, renderDeviationXlsx } from "./render-deviation";
import { CLOSING_LINE } from "./render-shared";
import { FINDINGS, SIDE } from "./render-test-support";

const MATTER = "Project Meridian — ACA review";

describe("renderDeviationXlsx", () => {
  const bytes = renderDeviationXlsx({ findings: FINDINGS, side: SIDE, matterTitle: MATTER });

  it("writes a Deviations sheet with the contract headers and one row per finding", () => {
    expect(listXlsxSheets(bytes)).toEqual([DEVIATIONS_SHEET, SUMMARY_SHEET]);
    const table = parseXlsx(bytes, { sheet: DEVIATIONS_SHEET });
    expect(table?.headers).toEqual([...DEVIATION_COLUMNS]);
    expect(table?.rows).toHaveLength(FINDINGS.length);
    expect(table?.ragged).toBe(false);
  });

  it("sorts rows by severity then clause and fills every column", () => {
    const rows = parseXlsx(bytes, { sheet: DEVIATIONS_SHEET })?.rows ?? [];
    expect(rows.map((row) => row[0])).toEqual(["§7.2(b)", "§3.4", "§9.1", "§11.2"]);
    expect(rows[0]).toEqual([
      "§7.2(b)",
      "Adverse provision",
      "Uncapped cost reimbursement",
      "the Borrower shall pay all costs of the Lenders",
      "No cap on Lender costs.",
      "high",
      "fallback",
      "the Borrower shall pay the reasonable and documented costs of the Lenders, subject to the Fee Cap",
      "S2 ¶41, PB CA-07",
      "",
    ]);
    expect(rows[3][1]).toBe("Interaction");
    expect(rows[3][7]).toBe("");
    expect(rows[3][9]).toBe("J. Partner");
  });

  it("writes a Summary sheet with the matter, position, severity and kind counts", () => {
    const summary = parseXlsx(bytes, { sheet: SUMMARY_SHEET });
    const cells = (summary?.rows ?? []).map((row) => row.join("|"));
    expect(summary?.headers[0]).toBe("Matter");
    expect(summary?.headers[1]).toBe(MATTER);
    expect(cells).toContain(`Position|Acting for ${SIDE.party} (${SIDE.role}) against ${SIDE.counterparty}.`);
    expect(cells).toContain("Findings|4");
    expect(cells).toContain("Reserved for partner decision|1");
    expect(cells).toContain("high|1");
    expect(cells).toContain("medium|2");
    expect(cells).toContain("low|1");
    expect(cells).toContain("Missing provision|1");
    expect(cells).toContain("Conforms|0");
    expect(cells).toContain(`${CLOSING_LINE}|`);
  });

  it("still produces both sheets when there are no findings", () => {
    const empty = renderDeviationXlsx({ findings: [], side: SIDE, matterTitle: MATTER });
    expect(listXlsxSheets(empty)).toEqual([DEVIATIONS_SHEET, SUMMARY_SHEET]);
    expect(parseXlsx(empty, { sheet: DEVIATIONS_SHEET })).toBeNull();
  });
});
