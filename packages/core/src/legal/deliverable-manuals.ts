/**
 * Format manuals for each deliverable, in formal register. Stage 5 (draft) attaches the relevant manual to
 * its stage card. These are the built-in defaults; a firm may override them with Manual sources in the
 * Knowledge Base without a release.
 */

import type { DeliverableKind } from "./types";

export const WORK_PRODUCT_LINE =
  "Draft work product prepared with automated assistance for review by a qualified lawyer.";

export const DELIVERABLE_LABELS: Readonly<Record<DeliverableKind, string>> = {
  "issues-memo": "issues memorandum",
  redline: "redline",
  "deviation-report": "deviation report",
  "executive-summary": "executive summary",
  "red-flags": "red-flags list",
};

const ISSUES_MEMO_MANUAL = [
  "ISSUES MEMORANDUM — FORMAT MANUAL",
  "Header block, one line each: To: <addressee>. From: <author of record>. Date: <date supplied by code>. Re: <matter title and document under review>.",
  "Mark the memorandum privileged and confidential unless instructed otherwise.",
  "Sections, in this order and under these headings:",
  "  1. Summary — three to six sentences stating the document reviewed, the overall position against the",
  "     executed terms and the playbook, and the number of high-severity points. No new facts.",
  "  2. Adverse provisions — one paragraph per finding of kind adverse, deviation or interaction, ordered by",
  "     severity then clause. Each paragraph states the clause, what the provision provides, why it is adverse",
  "     to the Client's position, the proposed language, and the basis citations. Reference findings by",
  "     {{F<n>}} token; code expands the token to the finding title and citation. Include a findings table",
  "     listing the ids of the findings covered.",
  "  3. Missing provisions — one paragraph per finding of kind missing, naming the checklist item, the",
  "     playbook position and the proposed insertion.",
  "  4. Unmarked changes — one paragraph per finding of kind unmarked-change, stating the clause, the text",
  "     before and after, and whether the change is acceptable.",
  "  5. Recommendations — numbered, one per material point, each stating the position to adopt (preferred,",
  "     fallback or walk-away) and the reason.",
  "  6. Reserved points — findings with a reservedFor value, listed with the person who reserved them and no",
  "     proposed language.",
  "Register: formal legal English. Parties by defined term, provisions by section number, documents by id.",
  "State what the documents provide. Do not characterise the counterparty's motives. Do not address the Client",
  "directly. No hedging filler, no exclamation, no colloquial phrasing.",
  "Numbers: cite by document reference or named computation only; free numbers are marked unverified by code.",
  "Quotations: verbatim from the cited document only; code rejects paraphrase within quotation marks.",
  `Closing line, always present and unchanged: "${WORK_PRODUCT_LINE}"`,
].join("\n");

const REDLINE_MANUAL = [
  "REDLINE — FORMAT MANUAL",
  "The redline is produced by code from the findings; no separate drafting is required. Each finding with",
  "non-null proposedText, a verbatim quote and a resolved anchor becomes one tracked change in the",
  "counterparty draft, authored in the name of the author of record, with a margin comment stating the",
  "finding title and its basis citations.",
  "Conventions applied by code:",
  "  Replacement text is inserted as a tracked insertion and the quoted text as a tracked deletion; the",
  "  counterparty's own revisions are preserved unchanged.",
  "  Findings of kind missing are inserted as a new paragraph after the best-matching clause, styled",
  "  from the preceding paragraph.",
  "  Reserved findings produce no change and no comment.",
  "  Comment text reads: <title>. Basis: <citations>.",
  "Requirements on proposedText for it to be accepted:",
  "  Drafted as it would appear in the agreement, with defined-term capitalisation and cross-references in",
  "  the document's own style; every section reference must resolve after the proposals are applied; every",
  "  defined term used must be defined in the draft or in a proposed definition.",
  `Closing line carried in the output metadata: "${WORK_PRODUCT_LINE}"`,
].join("\n");

const DEVIATION_REPORT_MANUAL = [
  "DEVIATION REPORT — FORMAT MANUAL",
  "The deviation report is a workbook produced by code from the findings; no separate drafting is required.",
  "Sheet Deviations: one row per finding, columns in this order:",
  "  Clause · Kind · Title · Provision (quote) · Why adverse · Severity · Negotiability · Proposed language · Basis · Reserved for",
  "Rows are ordered by severity (high, medium, low) then by clause path. Provision (quote) carries the",
  "verbatim text; Proposed language is blank for reserved findings; Basis lists citations as <doc> <ref>.",
  "Sheet Summary: counts of findings by severity and by kind, and the number of reserved points.",
  "Cell text is plain, without markup. Numbers appear only where they are cited by reference in a finding.",
  `Closing line placed under the Summary table: "${WORK_PRODUCT_LINE}"`,
].join("\n");

const EXECUTIVE_SUMMARY_MANUAL = [
  "EXECUTIVE SUMMARY — FORMAT MANUAL",
  "Header block, one line each: To: <addressee>. From: <author of record>. Date: <date supplied by code>. Re: <matter title>.",
  "Length: not more than one page. Sections, in this order:",
  "  1. Position — two to four sentences stating whether the draft reflects the executed terms and the",
  "     number of points requiring a decision.",
  "  2. Points requiring a decision — a numbered list of high-severity findings, each in one sentence, by",
  "     {{F<n>}} token.",
  "  3. Recommended next step — one paragraph in formal register.",
  "No quotations, no figures other than by reference, no characterisation of the counterparty's motives.",
  `Closing line, always present and unchanged: "${WORK_PRODUCT_LINE}"`,
].join("\n");

const RED_FLAGS_MANUAL = [
  "RED-FLAGS LIST — FORMAT MANUAL",
  "A Markdown document produced by code from the findings and the verification report; no separate drafting",
  "is required. Structure:",
  "  # <matter title> — red flags",
  "  ## Requires partner decision — findings of high severity and every reserved finding, one bullet each:",
  "     clause, title, one-sentence reason, basis citations.",
  "  ## Adverse provisions — remaining findings of kind adverse, deviation and interaction, grouped by severity.",
  "  ## Missing provisions — findings of kind missing with the checklist item id.",
  "  ## Unmarked changes — findings of kind unmarked-change.",
  "  ## Verification — one line per code check stating what was checked, how many passed, how many failed.",
  "  ## Documents skipped — document id and reason, or the words 'None skipped'.",
  "Plain declarative sentences throughout. Parties by defined term, provisions by section number.",
  `Closing line: "${WORK_PRODUCT_LINE}"`,
].join("\n");

export const DELIVERABLE_MANUALS: Readonly<Record<DeliverableKind, string>> = {
  "issues-memo": ISSUES_MEMO_MANUAL,
  redline: REDLINE_MANUAL,
  "deviation-report": DEVIATION_REPORT_MANUAL,
  "executive-summary": EXECUTIVE_SUMMARY_MANUAL,
  "red-flags": RED_FLAGS_MANUAL,
};
