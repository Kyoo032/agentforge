/**
 * Red-flags Markdown: the findings grouped by kind as tables, the verification result as
 * declarative lines, and the mandatory closing line.
 */
import { markdownTable } from "@agentforge/core/artifacts";
import {
  fillCopy,
  legalOutputCopy,
  type Finding,
  type FindingKind,
  type LegalLocale,
  type LegalSide,
  type VerifyCheck,
  type VerifyReport,
} from "@agentforge/core/legal";
import { formatBasis, positionLine, proposedLanguage, sortFindings } from "./render-shared";

export const RED_FLAG_SECTIONS = legalOutputCopy("en").redFlagSections;
export const VERIFICATION_HEADING = legalOutputCopy("en").verificationHeading;
export const VERIFICATION_NOT_RUN = legalOutputCopy("en").verificationNotRun;

const SECTION_KINDS: readonly (readonly FindingKind[])[] = [
  ["adverse", "deviation"],
  ["missing"],
  ["unmarked-change"],
  ["interaction"],
  [],
];

function findingRow(finding: Finding, locale: LegalLocale): readonly string[] {
  return [
    finding.clause,
    finding.title,
    finding.severity,
    finding.negotiability,
    finding.why,
    proposedLanguage(finding, locale),
    formatBasis(finding.basis, locale),
  ];
}

function reservedRow(finding: Finding, locale: LegalLocale): readonly string[] {
  return [
    finding.clause,
    finding.title,
    finding.severity,
    finding.reservedFor ?? "",
    finding.why,
    formatBasis(finding.basis, locale),
  ];
}

function section(
  heading: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
  empty: string,
): string[] {
  return [`## ${heading}`, "", rows.length === 0 ? empty : markdownTable(columns, rows), ""];
}

function kindSections(findings: readonly Finding[], locale: LegalLocale): string[] {
  const copy = legalOutputCopy(locale);
  const sorted = sortFindings(findings);
  return copy.redFlagSections.flatMap((heading, index) => {
    const kinds = SECTION_KINDS[index] ?? [];
    if (kinds.length === 0) {
      const reserved = sorted.filter((finding) => finding.reservedFor !== null);
      return section(heading, copy.reservedColumns, reserved.map((finding) => reservedRow(finding, locale)), copy.noneIdentified);
    }
    const rows = sorted.filter((finding) => kinds.includes(finding.kind)).map((finding) => findingRow(finding, locale));
    return section(heading, copy.findingColumns, rows, copy.noneIdentified);
  });
}

function checkLine(check: VerifyCheck, locale: LegalLocale): string {
  const copy = legalOutputCopy(locale);
  const status = check.failed === 0 ? copy.checkPassed : copy.checkFailed;
  const counts = fillCopy(copy.passedFailed, { passed: check.passed, failed: check.failed });
  return `- ${check.code} — ${status} (${counts})`;
}

function verificationSection(verify: VerifyReport | null, locale: LegalLocale): string[] {
  const copy = legalOutputCopy(locale);
  if (verify === null) {
    return [`## ${copy.verificationHeading}`, "", copy.verificationNotRun, ""];
  }
  const outcome = verify.ok ? copy.allChecksPassed : copy.someChecksFailed;
  const failures = verify.codeChecks.flatMap((check) =>
    check.failures.map((failure) => `  - ${failure.target}: ${failure.detail}`),
  );
  return [
    `## ${copy.verificationHeading}`,
    "",
    fillCopy(copy.roundLine, { round: verify.round, outcome }),
    "",
    ...verify.codeChecks.map((check) => checkLine(check, locale)),
    ...failures,
    "",
  ];
}

/** Markdown red-flags deliverable. */
export function renderRedFlagsMarkdown(input: {
  findings: readonly Finding[];
  side: LegalSide;
  matterTitle: string;
  verify: VerifyReport | null;
  locale?: LegalLocale;
}): string {
  const locale = input.locale ?? "en";
  const copy = legalOutputCopy(locale);
  return [
    `# ${input.matterTitle}`,
    "",
    `${copy.sheetPosition}: ${positionLine(input.side, locale)}`,
    "",
    ...kindSections(input.findings, locale),
    ...verificationSection(input.verify, locale),
    copy.closingLine,
    "",
  ].join("\n");
}
