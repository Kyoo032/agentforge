import { readDocx } from "@agentforge/core/docx";
import type { MemoOutline } from "@agentforge/core/legal";
import { describe, expect, it } from "vitest";
import {
  FINDINGS_TABLE_COLUMNS,
  MEMO_TITLE,
  PRIVILEGE_LINE,
  expandFindingTokens,
  renderMemoDocx,
  renderMemoText,
} from "./render-memo";
import { CLOSING_LINE, NOT_FOUND_TOKEN, findingsById } from "./render-shared";
import { FINDINGS, SIDE } from "./render-test-support";

const OUTLINE: MemoOutline = {
  to: "A. Addressee",
  from: "B. Author",
  date: "8 September 2026",
  re: "Account Control Agreement — issues list",
  privileged: true,
  sections: [
    {
      heading: "Summary of principal issues",
      paragraphs: ["The most significant issue is {{F1}}.", "A further point, {{F99}}, could not be located."],
      findingsTable: ["F1", "F3", "F99"],
    },
    { heading: "Missing provisions", paragraphs: ["{{ F2 }} should be added."] },
  ],
};

const F1_LABEL = "Uncapped cost reimbursement (§7.2(b); S2 ¶41, PB CA-07)";
const EXPECTED_TABLE_ROWS = 1 + 2;

describe("expandFindingTokens", () => {
  it("expands known ids to title, clause and basis, and marks unknown ids", () => {
    const byId = findingsById(FINDINGS);
    expect(expandFindingTokens("See {{F1}} and {{F9}}.", byId)).toBe(`See ${F1_LABEL} and ${NOT_FOUND_TOKEN}.`);
    expect(expandFindingTokens("No tokens here", byId)).toBe("No tokens here");
  });
});

describe("renderMemoText", () => {
  it("renders the header, expanded paragraphs, table rows and the closing line", () => {
    const text = renderMemoText(OUTLINE, FINDINGS);
    const lines = text.split("\n");
    expect(lines[0]).toBe(MEMO_TITLE);
    expect(lines[1]).toBe(PRIVILEGE_LINE);
    expect(lines.slice(2, 6)).toEqual([
      "To: A. Addressee",
      "From: B. Author",
      "Date: 8 September 2026",
      "Re: Account Control Agreement — issues list",
    ]);
    expect(text).toContain(`The most significant issue is ${F1_LABEL}.`);
    expect(text).toContain(`A further point, ${NOT_FOUND_TOKEN}, could not be located.`);
    expect(text).toContain(FINDINGS_TABLE_COLUMNS.join(" | "));
    expect(text).toContain(
      "§7.2(b) | the Borrower shall pay all costs of the Lenders | No cap on Lender costs. | high | ",
    );
    expect(text).toContain("No cure period for covenant breach (§9.1; PB CA-12) should be added.");
    expect(lines[lines.length - 1]).toBe(CLOSING_LINE);
  });

  it("omits the privilege line when the memo is not privileged", () => {
    const text = renderMemoText({ ...OUTLINE, privileged: false }, FINDINGS);
    expect(text).not.toContain(PRIVILEGE_LINE);
    expect(text.split("\n")[1]).toBe("To: A. Addressee");
  });
});

describe("renderMemoDocx", () => {
  it("re-reads as a docx with the header, one table with the listed rows, and the closing line", async () => {
    const { bytes } = await renderMemoDocx({ outline: OUTLINE, findings: FINDINGS, side: SIDE, firm: "Firm LLP" });
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    const doc = await readDocx(bytes);
    const paragraphs = doc.paragraphs.map((paragraph) => paragraph.text);
    expect(paragraphs[0]).toBe(MEMO_TITLE);
    expect(paragraphs).toContain(PRIVILEGE_LINE);
    expect(paragraphs).toContain("Firm: Firm LLP");
    expect(paragraphs).toContain("To: A. Addressee");
    expect(paragraphs).toContain(`The most significant issue is ${F1_LABEL}.`);
    expect(doc.tables).toHaveLength(1);
    expect(doc.tables[0].rows).toHaveLength(EXPECTED_TABLE_ROWS);
    expect(doc.tables[0].rows[0]).toEqual(FINDINGS_TABLE_COLUMNS);
    expect(doc.tables[0].rows[1][0]).toBe("§7.2(b)");
    const body = paragraphs.filter((line) => line.trim() !== "");
    expect(body[body.length - 1]).toBe(CLOSING_LINE);
  });

  it("returns the same text renderMemoText produces for the same context", async () => {
    const { text } = await renderMemoDocx({ outline: OUTLINE, findings: FINDINGS, side: SIDE, firm: "Firm LLP" });
    expect(text).toBe(renderMemoText(OUTLINE, FINDINGS, { side: SIDE, firm: "Firm LLP" }));
    expect(text).toContain(F1_LABEL);
    expect(text).toContain(`Acting for ${SIDE.party} (${SIDE.role}) against ${SIDE.counterparty}.`);
    expect(text.endsWith(CLOSING_LINE)).toBe(true);
  });
});
