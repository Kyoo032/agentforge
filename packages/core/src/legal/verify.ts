/**
 * Legal mode — deterministic code checks over findings and rendered deliverables.
 *
 * Always returns all eight checks in VERIFY_CHECK_ORDER. Pure: no I/O and no mutation of the input.
 * Model checks never overrule these; any failure is a failure of the round, except `coverage`,
 * which is informational (see checkCoverage / verifyOk).
 */

import { findQuote } from "../docx/text";
import type { DocxClause, DocxDocument, DocxValidation } from "../docx/types";
import { guardNumbers } from "../finance/number-guard";
import type { Finding, MemoOutline, VerifyCheck, VerifyCheckCode, VerifyFailure } from "./types";
import {
  extractDefinedTermCandidates,
  extractDefinitionTerms,
  extractQuotedStrings,
  extractXrefs,
  maskXrefs,
  normaliseClauseId,
  termKey,
} from "./verify-text";

export { extractXrefs, normaliseClauseId } from "./verify-text";

export type CodeCheckInput = {
  findings: readonly Finding[];
  /** By doc id; the counterparty draft is included. */
  docs: ReadonlyMap<string, DocxDocument>;
  counterpartyDocId: string;
  /** Clauses of the counterparty draft. */
  clauses: readonly DocxClause[];
  memo: MemoOutline | null;
  /** Rendered plain text of the memo, for the number, quote, cross-reference and name checks. */
  memoText: string | null;
  /** Every number extracted from the matter documents. */
  allowedNumbers: readonly number[];
  facts: { parties: readonly string[]; addressee: string; author: string; dateIso: string };
  instructions: readonly { reservedClause: string; by: string }[];
  redline: { validation: DocxValidation; failed: number } | null;
  readDocIds: readonly string[];
  citedDocIds: readonly string[];
  skipped: readonly { doc: string; reason: string }[];
};

export const VERIFY_CHECK_ORDER: readonly VerifyCheckCode[] = [
  "quotes-verbatim",
  "numbers-traced",
  "xrefs-resolve",
  "defined-terms",
  "facts-match",
  "instructions-obeyed",
  "docx-valid",
  "coverage",
];

/** Quoted strings in the memo shorter than this are treated as ordinary prose, not citations. */
export const MEMO_QUOTE_MIN_CHARS = 25;
const DETAIL_EXCERPT_CHARS = 60;
const MEMO_TARGET = "memo";
const MEMO_DELIVERABLE: VerifyFailure["deliverable"] = "issues-memo";
const REDLINE_TARGET = "redline";

type Failure = Omit<VerifyFailure, "code">;

function fail(deliverable: Failure["deliverable"], target: string, detail: string, autoFixable = false): Failure {
  return { deliverable, target, detail, autoFixable };
}

function makeCheck(code: VerifyCheckCode, checked: number, failures: readonly Failure[]): VerifyCheck {
  const tagged = failures.map((failure) => ({ code, ...failure }));
  return { code, passed: Math.max(0, checked - tagged.length), failed: tagged.length, failures: tagged };
}

function excerpt(text: string): string {
  return text.length > DETAIL_EXCERPT_CHARS ? `${text.slice(0, DETAIL_EXCERPT_CHARS)}…` : text;
}

function containsIgnoreCase(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

/** Every non-empty finding quote is verbatim in the counterparty draft; every long memo quote is in some doc. */
function checkQuotesVerbatim(input: CodeCheckInput): VerifyCheck {
  const draft = input.docs.get(input.counterpartyDocId);
  const quoted = input.findings.filter((finding) => finding.quote.trim() !== "");
  const findingFailures = quoted
    .filter((finding) => draft === undefined || findQuote(draft, finding.quote) === null)
    .map((finding) =>
      fail(
        "findings",
        finding.id,
        draft === undefined
          ? `counterparty draft ${input.counterpartyDocId} is not loaded; cannot verify "${excerpt(finding.quote)}"`
          : `quote not found verbatim in ${input.counterpartyDocId}: "${excerpt(finding.quote)}"`,
      ),
    );
  const memoQuotes = input.memoText === null ? [] : extractQuotedStrings(input.memoText, MEMO_QUOTE_MIN_CHARS);
  const allDocs = [...input.docs.values()];
  const memoFailures = memoQuotes
    .filter((quote) => !allDocs.some((doc) => findQuote(doc, quote) !== null))
    .map((quote) => fail(MEMO_DELIVERABLE, MEMO_TARGET, `memo quote not found in any document: "${excerpt(quote)}"`));
  return makeCheck("quotes-verbatim", quoted.length + memoQuotes.length, [...findingFailures, ...memoFailures]);
}

/** Number guard over the memo text. Cross-reference tokens are masked first so "§7.2" is not read as 7.2. */
function checkNumbersTraced(input: CodeCheckInput): VerifyCheck {
  if (input.memoText === null) {
    return makeCheck("numbers-traced", 0, []);
  }
  const result = guardNumbers(maskXrefs(input.memoText), input.allowedNumbers);
  const failures = result.flagged.map((token) =>
    fail(MEMO_DELIVERABLE, MEMO_TARGET, `figure "${token.text}" does not trace to any matter document`),
  );
  return makeCheck("numbers-traced", result.flagged.length + result.verified.length, failures);
}

/** A reference resolves when it equals a clause id or is an ancestor path of one ("§7" for "§7.2"). */
function xrefResolves(xref: string, clauseIds: ReadonlySet<string>): boolean {
  if (clauseIds.has(xref)) {
    return true;
  }
  return [...clauseIds].some((id) => id.startsWith(`${xref}.`) || id.startsWith(`${xref}(`));
}

function checkXrefsResolve(input: CodeCheckInput): VerifyCheck {
  const clauseIds = new Set(input.clauses.map((clause) => normaliseClauseId(clause.id)));
  const sources = [
    ...input.findings
      .filter((finding) => finding.proposedText !== null)
      .map((finding) => ({ target: finding.id, deliverable: "findings" as const, text: finding.proposedText ?? "" })),
    ...(input.memoText === null ? [] : [{ target: MEMO_TARGET, deliverable: MEMO_DELIVERABLE, text: input.memoText }]),
  ];
  const results = sources.flatMap((source) =>
    extractXrefs(source.text).map((xref) => ({ source, xref, ok: xrefResolves(xref, clauseIds) })),
  );
  const failures = results
    .filter((result) => !result.ok)
    .map((result) =>
      fail(result.source.deliverable, result.source.target, `cross-reference ${result.xref} is not a clause`, true),
    );
  return makeCheck("xrefs-resolve", results.length, failures);
}

/** Capitalised multi-word terms in proposedText are defined in the draft or by a "missing" finding. */
function checkDefinedTerms(input: CodeCheckInput): VerifyCheck {
  const draft = input.docs.get(input.counterpartyDocId);
  const draftTerms = (draft?.definedTerms ?? []).map((term) => termKey(term.term));
  const proposedTerms = input.findings
    .filter((finding) => finding.kind === "missing" && finding.proposedText !== null)
    .flatMap((finding) => extractDefinitionTerms(finding.proposedText ?? ""));
  const defined = new Set([...draftTerms, ...proposedTerms]);
  const results = input.findings
    .filter((finding) => finding.proposedText !== null)
    .flatMap((finding) =>
      extractDefinedTermCandidates(finding.proposedText ?? "", input.facts.parties).map((term) => ({
        finding,
        term,
        ok: defined.has(termKey(term)),
      })),
    );
  const failures = results
    .filter((result) => !result.ok)
    .map((result) => fail("findings", result.finding.id, `term "${result.term}" is not defined in the draft`));
  return makeCheck("defined-terms", results.length, failures);
}

/** Memo header names match the extracted facts and every party is named in the memo text. */
function checkFactsMatch(input: CodeCheckInput): VerifyCheck {
  const memo = input.memo;
  if (memo === null) {
    return makeCheck("facts-match", 0, []);
  }
  const header = [
    { target: "to", expected: input.facts.addressee, actual: memo.to },
    { target: "from", expected: input.facts.author, actual: memo.from },
  ].filter((item) => item.expected.trim() !== "");
  const headerFailures = header
    .filter((item) => !containsIgnoreCase(item.actual, item.expected))
    .map((item) =>
      fail(MEMO_DELIVERABLE, item.target, `memo ${item.target} "${item.actual}" does not name "${item.expected}"`),
    );
  const parties = input.memoText === null ? [] : input.facts.parties.filter((party) => party.trim() !== "");
  const partyFailures = parties
    .filter((party) => !containsIgnoreCase(input.memoText ?? "", party))
    .map((party) => fail(MEMO_DELIVERABLE, MEMO_TARGET, `party "${party}" is not named in the memo`));
  return makeCheck("facts-match", header.length + parties.length, [...headerFailures, ...partyFailures]);
}

/** Findings on a clause reserved by an instruction carry no proposedText and name who reserved it. */
function checkInstructionsObeyed(input: CodeCheckInput): VerifyCheck {
  const reserved = new Map(
    input.instructions.map((instruction) => [normaliseClauseId(instruction.reservedClause), instruction.by]),
  );
  const affected = input.findings
    .map((finding) => ({ finding, by: reserved.get(normaliseClauseId(finding.clause)) }))
    .filter((item): item is { finding: Finding; by: string } => item.by !== undefined);
  const failures = affected.flatMap(({ finding, by }) => {
    const label = `clause ${finding.clause} is reserved by ${by}`;
    return [
      ...(finding.proposedText === null
        ? []
        : [fail("findings", finding.id, `${label}: proposedText must be null`, true)]),
      ...(finding.reservedFor ? [] : [fail("findings", finding.id, `${label}: reservedFor must be set`, true)]),
    ];
  });
  const compliant = affected.filter(({ finding }) => finding.proposedText === null && finding.reservedFor).length;
  return makeCheck("instructions-obeyed", compliant + failures.length, failures);
}

/** The redline package validates and every patch applied. Skipped when no redline was produced. */
function checkDocxValid(input: CodeCheckInput): VerifyCheck {
  if (input.redline === null) {
    return makeCheck("docx-valid", 0, []);
  }
  const issueFailures = input.redline.validation.issues.map((issue) =>
    fail("redline", REDLINE_TARGET, `${issue.code}: ${issue.detail}`),
  );
  const notOk =
    input.redline.validation.ok || issueFailures.length > 0
      ? []
      : [fail("redline", REDLINE_TARGET, "redline package failed validation")];
  const patchFailures =
    input.redline.failed > 0
      ? [fail("redline", REDLINE_TARGET, `${input.redline.failed} redline patch(es) failed to apply`)]
      : [];
  return makeCheck("docx-valid", 1, [...issueFailures, ...notOk, ...patchFailures]);
}

/**
 * Informational: every read document is cited, and skipped documents are listed with their reason.
 * Failures here are reported but never fixed and never block the round (see verifyOk).
 */
function checkCoverage(input: CodeCheckInput): VerifyCheck {
  const cited = new Set(input.citedDocIds);
  const uncited = input.readDocIds.filter((id) => !cited.has(id)).map((id) => fail("findings", id, "read, not cited"));
  const skipped = input.skipped.map((entry) => fail("findings", entry.doc, `skipped: ${entry.reason}`));
  return makeCheck("coverage", input.readDocIds.length + input.skipped.length, [...uncited, ...skipped]);
}

const CHECKS: Readonly<Record<VerifyCheckCode, (input: CodeCheckInput) => VerifyCheck>> = {
  "quotes-verbatim": checkQuotesVerbatim,
  "numbers-traced": checkNumbersTraced,
  "xrefs-resolve": checkXrefsResolve,
  "defined-terms": checkDefinedTerms,
  "facts-match": checkFactsMatch,
  "instructions-obeyed": checkInstructionsObeyed,
  "docx-valid": checkDocxValid,
  coverage: checkCoverage,
};

/** Runs all eight checks in contract order. Never throws on odd input; never mutates it. */
export function runCodeChecks(input: CodeCheckInput): VerifyCheck[] {
  return VERIFY_CHECK_ORDER.map((code) => CHECKS[code](input));
}

/** True when every blocking check (everything except `coverage`) has no failures. */
export function verifyOk(checks: readonly VerifyCheck[]): boolean {
  return checks.filter((check) => check.code !== "coverage").every((check) => check.failed === 0);
}

export function summarizeChecks(checks: readonly VerifyCheck[]): { passed: number; failed: number } {
  return checks.reduce(
    (totals, check) => ({ passed: totals.passed + check.passed, failed: totals.failed + check.failed }),
    { passed: 0, failed: 0 },
  );
}
