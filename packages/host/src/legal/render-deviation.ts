/**
 * Deviation report: one workbook, a "Deviations" sheet with one row per finding and a
 * "Summary" sheet with counts. Nothing here comes from the model beyond the findings themselves.
 */
import {
  FINDING_KINDS,
  legalOutputCopy,
  type Finding,
  type LegalLocale,
  type LegalSide,
  SEVERITIES,
} from "@agentforge/core/legal";
import { type WorkbookCell, type WorkbookSheet, writeWorkbook } from "@agentforge/core/tabular";
import { countBy, formatBasis, positionLine, sortFindings } from "./render-shared";

export const DEVIATIONS_SHEET = legalOutputCopy("en").deviationsSheet;
export const SUMMARY_SHEET = legalOutputCopy("en").summarySheet;

export const DEVIATION_COLUMNS = legalOutputCopy("en").deviationColumns;

/** Character widths per DEVIATION_COLUMNS entry. */
const DEVIATION_WIDTHS = [14, 18, 32, 48, 48, 10, 14, 48, 22, 18];
const SUMMARY_WIDTHS = [26, 12];

function deviationRow(finding: Finding, locale: LegalLocale): readonly WorkbookCell[] {
  const copy = legalOutputCopy(locale);
  return [
    finding.clause,
    copy.kindLabels[finding.kind],
    finding.title,
    finding.quote,
    finding.why,
    finding.severity,
    finding.negotiability,
    finding.proposedText,
    formatBasis(finding.basis, locale),
    finding.reservedFor,
  ];
}

function deviationsSheet(findings: readonly Finding[], locale: LegalLocale): WorkbookSheet {
  const copy = legalOutputCopy(locale);
  return {
    name: copy.deviationsSheet,
    rows: [[...copy.deviationColumns], ...sortFindings(findings).map((finding) => deviationRow(finding, locale))],
    widths: DEVIATION_WIDTHS,
  };
}

function countRows(
  label: string,
  counts: readonly (readonly [string, number])[],
  display: (key: string) => string,
  countLabel: string,
): readonly (readonly WorkbookCell[])[] {
  return [[label, countLabel], ...counts.map(([key, count]) => [display(key), count] as const)];
}

function summarySheet(findings: readonly Finding[], side: LegalSide, matterTitle: string, locale: LegalLocale): WorkbookSheet {
  const copy = legalOutputCopy(locale);
  const bySeverity = countBy(SEVERITIES, findings, (finding) => finding.severity);
  const byKind = countBy(FINDING_KINDS, findings, (finding) => finding.kind);
  const reserved = findings.filter((finding) => finding.reservedFor !== null).length;
  return {
    name: copy.summarySheet,
    rows: [
      [copy.sheetMatter, matterTitle],
      [copy.sheetPosition, positionLine(side, locale)],
      [copy.sheetFindings, findings.length],
      [copy.sheetReserved, reserved],
      [null, null],
      ...countRows(copy.sheetSeverity, bySeverity, (key) => key, copy.sheetCount),
      [null, null],
      ...countRows(copy.sheetKind, byKind, (key) => copy.kindLabels[key as Finding["kind"]], copy.sheetCount),
      [null, null],
      [copy.closingLine, null],
    ],
    widths: SUMMARY_WIDTHS,
  };
}

/** Deviation report workbook bytes. */
export function renderDeviationXlsx(input: {
  findings: readonly Finding[];
  side: LegalSide;
  matterTitle: string;
  locale?: LegalLocale;
}): Uint8Array {
  const locale = input.locale ?? "en";
  return writeWorkbook([
    deviationsSheet(input.findings, locale),
    summarySheet(input.findings, input.side, input.matterTitle, locale),
  ]);
}
