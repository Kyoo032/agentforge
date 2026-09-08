/**
 * Deviation report: one workbook, a "Deviations" sheet with one row per finding and a
 * "Summary" sheet with counts. Nothing here comes from the model beyond the findings themselves.
 */
import { FINDING_KINDS, type Finding, type LegalSide, SEVERITIES } from "@agentforge/core/legal";
import { type WorkbookCell, type WorkbookSheet, writeWorkbook } from "@agentforge/core/tabular";
import { CLOSING_LINE, KIND_LABELS, countBy, formatBasis, positionLine, sortFindings } from "./render-shared";

export const DEVIATIONS_SHEET = "Deviations";
export const SUMMARY_SHEET = "Summary";

export const DEVIATION_COLUMNS = [
  "Clause",
  "Kind",
  "Title",
  "Provision (quote)",
  "Why adverse",
  "Severity",
  "Negotiability",
  "Proposed language",
  "Basis",
  "Reserved for",
] as const;

/** Character widths per DEVIATION_COLUMNS entry. */
const DEVIATION_WIDTHS = [14, 18, 32, 48, 48, 10, 14, 48, 22, 18];
const SUMMARY_WIDTHS = [26, 12];

function deviationRow(finding: Finding): readonly WorkbookCell[] {
  return [
    finding.clause,
    KIND_LABELS[finding.kind],
    finding.title,
    finding.quote,
    finding.why,
    finding.severity,
    finding.negotiability,
    finding.proposedText,
    formatBasis(finding.basis),
    finding.reservedFor,
  ];
}

function deviationsSheet(findings: readonly Finding[]): WorkbookSheet {
  return {
    name: DEVIATIONS_SHEET,
    rows: [[...DEVIATION_COLUMNS], ...sortFindings(findings).map(deviationRow)],
    widths: DEVIATION_WIDTHS,
  };
}

function countRows(
  label: string,
  counts: readonly (readonly [string, number])[],
  display: (key: string) => string,
): readonly (readonly WorkbookCell[])[] {
  return [[label, "Count"], ...counts.map(([key, count]) => [display(key), count] as const)];
}

function summarySheet(findings: readonly Finding[], side: LegalSide, matterTitle: string): WorkbookSheet {
  const bySeverity = countBy(SEVERITIES, findings, (finding) => finding.severity);
  const byKind = countBy(FINDING_KINDS, findings, (finding) => finding.kind);
  const reserved = findings.filter((finding) => finding.reservedFor !== null).length;
  return {
    name: SUMMARY_SHEET,
    rows: [
      ["Matter", matterTitle],
      ["Position", positionLine(side)],
      ["Findings", findings.length],
      ["Reserved for partner decision", reserved],
      [null, null],
      ...countRows("Severity", bySeverity, (key) => key),
      [null, null],
      ...countRows("Kind", byKind, (key) => KIND_LABELS[key as Finding["kind"]]),
      [null, null],
      [CLOSING_LINE, null],
    ],
    widths: SUMMARY_WIDTHS,
  };
}

/** Deviation report workbook bytes. */
export function renderDeviationXlsx(input: {
  findings: readonly Finding[];
  side: LegalSide;
  matterTitle: string;
}): Uint8Array {
  return writeWorkbook([deviationsSheet(input.findings), summarySheet(input.findings, input.side, input.matterTitle)]);
}
