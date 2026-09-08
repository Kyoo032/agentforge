/**
 * Red-flags Markdown: the findings grouped by kind as tables, the verification result as
 * declarative lines, and the mandatory closing line.
 */
import { markdownTable } from "@agentforge/core/artifacts";
import type { Finding, FindingKind, LegalSide, VerifyCheck, VerifyReport } from "@agentforge/core/legal";
import {
  CLOSING_LINE,
  NONE_IDENTIFIED,
  formatBasis,
  positionLine,
  proposedLanguage,
  sortFindings,
} from "./render-shared";

export const RED_FLAG_SECTIONS = [
  "Adverse provisions",
  "Missing provisions",
  "Unmarked changes",
  "Interactions",
  "Reserved for partner decision",
] as const;
export const VERIFICATION_HEADING = "Verification";
export const VERIFICATION_NOT_RUN = "Verification was not run.";

const SECTION_KINDS: Readonly<Record<(typeof RED_FLAG_SECTIONS)[number], readonly FindingKind[]>> = {
  "Adverse provisions": ["adverse", "deviation"],
  "Missing provisions": ["missing"],
  "Unmarked changes": ["unmarked-change"],
  Interactions: ["interaction"],
  "Reserved for partner decision": [],
};

const FINDING_COLUMNS = ["Clause", "Title", "Severity", "Negotiability", "Why adverse", "Proposed language", "Basis"];
const RESERVED_COLUMNS = ["Clause", "Title", "Severity", "Reserved for", "Why adverse", "Basis"];

function findingRow(finding: Finding): readonly string[] {
  return [
    finding.clause,
    finding.title,
    finding.severity,
    finding.negotiability,
    finding.why,
    proposedLanguage(finding),
    formatBasis(finding.basis),
  ];
}

function reservedRow(finding: Finding): readonly string[] {
  return [
    finding.clause,
    finding.title,
    finding.severity,
    finding.reservedFor ?? "",
    finding.why,
    formatBasis(finding.basis),
  ];
}

function section(heading: string, columns: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [`## ${heading}`, "", rows.length === 0 ? NONE_IDENTIFIED : markdownTable(columns, rows), ""];
}

function kindSections(findings: readonly Finding[]): string[] {
  const sorted = sortFindings(findings);
  return RED_FLAG_SECTIONS.flatMap((heading) => {
    const kinds = SECTION_KINDS[heading];
    if (kinds.length === 0) {
      const reserved = sorted.filter((finding) => finding.reservedFor !== null);
      return section(heading, RESERVED_COLUMNS, reserved.map(reservedRow));
    }
    const rows = sorted.filter((finding) => kinds.includes(finding.kind)).map(findingRow);
    return section(heading, FINDING_COLUMNS, rows);
  });
}

function checkLine(check: VerifyCheck): string {
  const status = check.failed === 0 ? "passed" : "failed";
  const counts = `${check.passed} passed, ${check.failed} failed`;
  return `- ${check.code} — ${status} (${counts})`;
}

function verificationSection(verify: VerifyReport | null): string[] {
  if (verify === null) {
    return [`## ${VERIFICATION_HEADING}`, "", VERIFICATION_NOT_RUN, ""];
  }
  const outcome = verify.ok ? "All code checks passed." : "One or more code checks failed.";
  const failures = verify.codeChecks.flatMap((check) =>
    check.failures.map((failure) => `  - ${failure.target}: ${failure.detail}`),
  );
  return [
    `## ${VERIFICATION_HEADING}`,
    "",
    `Round ${verify.round}. ${outcome}`,
    "",
    ...verify.codeChecks.map(checkLine),
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
}): string {
  return [
    `# ${input.matterTitle}`,
    "",
    `Position: ${positionLine(input.side)}`,
    "",
    ...kindSections(input.findings),
    ...verificationSection(input.verify),
    CLOSING_LINE,
    "",
  ].join("\n");
}
