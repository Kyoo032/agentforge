import { describe, expect, it } from "vitest";
import {
  RED_FLAG_SECTIONS,
  VERIFICATION_HEADING,
  VERIFICATION_NOT_RUN,
  renderRedFlagsMarkdown,
} from "./render-redflags";
import { CLOSING_LINE, NONE_IDENTIFIED } from "./render-shared";
import { FINDINGS, SIDE, VERIFY } from "./render-test-support";

const MATTER = "Project Meridian — ACA review";

function sectionBody(markdown: string, heading: string): string {
  const start = markdown.indexOf(`## ${heading}`);
  const next = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

describe("renderRedFlagsMarkdown", () => {
  const markdown = renderRedFlagsMarkdown({ findings: FINDINGS, side: SIDE, matterTitle: MATTER, verify: VERIFY });

  it("has the title, position line, every section heading and the closing line", () => {
    expect(markdown.startsWith(`# ${MATTER}\n`)).toBe(true);
    expect(markdown).toContain(`Position: Acting for ${SIDE.party} (${SIDE.role}) against ${SIDE.counterparty}.`);
    for (const heading of RED_FLAG_SECTIONS) {
      expect(markdown).toContain(`## ${heading}`);
    }
    expect(markdown).toContain(`## ${VERIFICATION_HEADING}`);
    expect(markdown.trimEnd().endsWith(CLOSING_LINE)).toBe(true);
  });

  it("places each finding in the table for its kind", () => {
    expect(sectionBody(markdown, "Adverse provisions")).toContain("| §7.2(b) | Uncapped cost reimbursement | high |");
    expect(sectionBody(markdown, "Missing provisions")).toContain("| §9.1 | No cure period for covenant breach |");
    expect(sectionBody(markdown, "Unmarked changes")).toContain("| §3.4 | Notice period shortened without marking |");
    const interactions = sectionBody(markdown, "Interactions");
    expect(interactions).toContain("| §11.2 | Change of Control interacts with mandatory prepayment |");
    expect(interactions).toContain("| Reserved for J. Partner |");
    const reserved = sectionBody(markdown, "Reserved for partner decision");
    expect(reserved).toContain("| Clause | Title | Severity | Reserved for |");
    expect(reserved).toContain("| §11.2 | Change of Control interacts with mandatory prepayment | low | J. Partner |");
    expect(reserved).not.toContain("§7.2(b)");
  });

  it("lists each code check as passed or failed with the failure detail", () => {
    const verification = sectionBody(markdown, VERIFICATION_HEADING);
    expect(verification).toContain("Round 1. One or more code checks failed.");
    expect(verification).toContain("- quotes-verbatim — passed (3 passed, 0 failed)");
    expect(verification).toContain("- xrefs-resolve — failed (1 passed, 1 failed)");
    expect(verification).toContain("  - §5.9: No such clause");
  });

  it("states that verification was not run when the report is null", () => {
    const text = renderRedFlagsMarkdown({ findings: FINDINGS, side: SIDE, matterTitle: MATTER, verify: null });
    expect(sectionBody(text, VERIFICATION_HEADING)).toContain(VERIFICATION_NOT_RUN);
    expect(text).not.toContain("quotes-verbatim");
  });

  it("marks empty sections rather than omitting them", () => {
    const text = renderRedFlagsMarkdown({ findings: [], side: SIDE, matterTitle: MATTER, verify: null });
    for (const heading of RED_FLAG_SECTIONS) {
      expect(sectionBody(text, heading)).toContain(NONE_IDENTIFIED);
    }
    expect(text.trimEnd().endsWith(CLOSING_LINE)).toBe(true);
  });
});
