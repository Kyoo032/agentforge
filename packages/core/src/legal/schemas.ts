/**
 * Zod schemas for everything the model returns. Parse model output through these before trusting it.
 * Prose fields are capped so a runaway answer cannot blow up the ledger.
 */

import { z } from "zod";
import { DOC_ROLES, FINDING_KINDS, NEGOTIABILITY, SEVERITIES } from "./types";

const PROSE_MAX = 2_000;
const QUOTE_MAX = 1_500;
const CLAUSE_TEXT_MAX = 6_000;
const SHORT_MAX = 200;

const anchorSchema = z.string().regex(/^¶\d+$/, "paragraph anchor must look like ¶12");

export const citationSchema = z.object({
  doc: z.string().min(1).max(SHORT_MAX),
  ref: z.string().min(1).max(SHORT_MAX),
});

/** What the review stage asks the model for, per clause. Code adds id, round, and quoteAnchor. */
export const findingDraftSchema = z.object({
  kind: z.enum(FINDING_KINDS),
  clause: z.string().min(1).max(SHORT_MAX),
  quote: z.string().max(QUOTE_MAX).default(""),
  title: z.string().min(1).max(SHORT_MAX),
  why: z.string().max(PROSE_MAX).default(""),
  severity: z.enum(SEVERITIES).default("low"),
  negotiability: z.enum(NEGOTIABILITY).default("fallback"),
  proposedText: z.string().max(CLAUSE_TEXT_MAX).nullable().default(null),
  basis: z.array(citationSchema).max(12).default([]),
  reservedFor: z.string().max(SHORT_MAX).nullable().default(null),
  checklist: z.array(z.string().max(SHORT_MAX)).max(20).default([]),
});
export type FindingDraft = z.infer<typeof findingDraftSchema>;

/** A clause the model judged acceptable as drafted. */
export const clauseOkSchema = z.object({ kind: z.literal("ok"), clause: z.string().max(SHORT_MAX).optional() });

/** Review stage response: either one finding, several findings, or ok. */
export const reviewResponseSchema = z.union([
  clauseOkSchema,
  findingDraftSchema,
  z.object({ findings: z.array(findingDraftSchema).max(8) }),
]);

export const classifyResponseSchema = z.object({
  docs: z
    .array(
      z.object({
        id: z.string().min(1).max(SHORT_MAX),
        role: z.enum(DOC_ROLES),
        reason: z.string().max(SHORT_MAX).default(""),
      }),
    )
    .max(200),
});
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;

export const missingConfirmSchema = z.object({
  itemId: z.string().min(1).max(SHORT_MAX),
  absent: z.boolean(),
  /** When not absent: the clause id and anchor where the model found it. */
  foundIn: z.object({ clause: z.string().max(SHORT_MAX), anchor: anchorSchema }).nullable().default(null),
  reason: z.string().max(PROSE_MAX).default(""),
});

export const interactionResponseSchema = z.object({
  compounds: z.boolean(),
  clause: z.string().max(SHORT_MAX).default(""),
  why: z.string().max(PROSE_MAX).default(""),
  severity: z.enum(SEVERITIES).default("medium"),
  quote: z.string().max(QUOTE_MAX).default(""),
});

export const memoSectionSchema = z.object({
  heading: z.string().min(1).max(SHORT_MAX),
  paragraphs: z.array(z.string().max(PROSE_MAX)).max(30),
  findingsTable: z.array(z.string().max(SHORT_MAX)).max(100).optional(),
});

export const memoOutlineSchema = z.object({
  to: z.string().max(SHORT_MAX),
  from: z.string().max(SHORT_MAX),
  date: z.string().max(SHORT_MAX),
  re: z.string().max(SHORT_MAX),
  privileged: z.boolean().default(true),
  sections: z.array(memoSectionSchema).min(1).max(20),
});

export const checklistVerdictSchema = z.object({
  itemId: z.string().min(1).max(SHORT_MAX),
  pass: z.boolean(),
  reason: z.string().max(PROSE_MAX).default(""),
});

export const checklistVerifyResponseSchema = z.object({
  verdicts: z.array(checklistVerdictSchema).max(50),
});

export const concessionSchema = z.object({
  clause: z.string().min(1).max(SHORT_MAX),
  detail: z.string().min(1).max(PROSE_MAX),
  disposition: z.enum(["fix", "market", "reserved"]).default("fix"),
});

export const opposingCounselResponseSchema = z.object({
  concessions: z.array(concessionSchema).max(30),
});

/** Stage 7 replacement for one memo section. */
export const sectionEditResponseSchema = z.object({ section: memoSectionSchema });

/** Stage 7 replacement for one finding's proposed language or quote. */
export const findingEditResponseSchema = z.object({
  quote: z.string().max(QUOTE_MAX).optional(),
  proposedText: z.string().max(CLAUSE_TEXT_MAX).nullable().optional(),
  why: z.string().max(PROSE_MAX).optional(),
});

/**
 * Strip a Markdown code fence and parse JSON. Returns null on any failure so callers can retry once
 * and then drop the answer, per the harness contract.
 */
export function parseModelJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const body = fenced ? fenced[1] : trimmed;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(body.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}
