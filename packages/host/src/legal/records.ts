/**
 * Legal mode — on-disk record shapes and the zod schemas that guard them when read back.
 *
 * `matter.json` and `runs/<id>.json` are written by the store and re-read on every request, so
 * they are treated as untrusted input: every read passes through these schemas.
 */

import { z } from "zod";
import {
  DELIVERABLE_KINDS,
  DOC_ROLES,
  LEGAL_WORK_TYPES,
  type DeliverableKind,
  type Finding,
  type LegalManifest,
  type LegalSide,
  type LegalWorkType,
  type MatterDocCard,
  type VerifyReport,
} from "@agentforge/core/legal";

export type LegalMatterRecord = {
  id: string;
  workspaceId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  side: LegalSide;
  workType: LegalWorkType;
  deliverables: DeliverableKind[];
  instructions: string;
  playbookId: string | null;
  author: string;
  addressee: string;
  firm: string;
  /** Roles editable via PATCH; the classify stage sets real roles on run. */
  docs: MatterDocCard[];
  priorMatterId: string | null;
  lastRunId: string | null;
};

export type LegalRunArtifact = { kind: DeliverableKind; artifactId: string; filename: string };

export type LegalRunRecord = {
  id: string;
  matterId: string;
  startedAt: number;
  finishedAt: number | null;
  manifest: LegalManifest;
  findings: Finding[];
  verify: VerifyReport | null;
  artifacts: LegalRunArtifact[];
  error: { code: string; message: string } | null;
};

const legalSideSchema = z.object({
  role: z.string(),
  party: z.string(),
  counterparty: z.string(),
});

export const matterDocCardSchema: z.ZodType<MatterDocCard> = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  mime: z.string(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string(),
  role: z.enum(DOC_ROLES),
  status: z.enum(["read", "skipped"]),
  skipReason: z.string().optional(),
  paragraphs: z.number().int().nonnegative(),
  words: z.number().int().nonnegative(),
  insertions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  definedTerms: z.number().int().nonnegative(),
  preview: z.string(),
});

export const legalMatterRecordSchema: z.ZodType<LegalMatterRecord> = z.object({
  id: z.string(),
  workspaceId: z.string(),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  side: legalSideSchema,
  workType: z.enum(LEGAL_WORK_TYPES),
  deliverables: z.array(z.enum(DELIVERABLE_KINDS)),
  instructions: z.string(),
  playbookId: z.string().nullable(),
  author: z.string(),
  addressee: z.string(),
  firm: z.string(),
  docs: z.array(matterDocCardSchema),
  priorMatterId: z.string().nullable(),
  lastRunId: z.string().nullable(),
});

const isRecordObject = (value: unknown): boolean => typeof value === "object" && value !== null;

/**
 * Run records embed the pipeline's manifest, findings, and verify report. Those shapes are owned by
 * `@agentforge/core/legal`; the store checks the envelope and that the nested values are objects.
 */
export const legalRunRecordSchema: z.ZodType<LegalRunRecord> = z.object({
  id: z.string(),
  matterId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable(),
  manifest: z.custom<LegalManifest>(isRecordObject, "manifest must be an object"),
  findings: z.array(z.custom<Finding>(isRecordObject, "finding must be an object")),
  verify: z.custom<VerifyReport>(isRecordObject, "verify must be an object").nullable(),
  artifacts: z.array(
    z.object({
      kind: z.enum(DELIVERABLE_KINDS),
      artifactId: z.string(),
      filename: z.string(),
    }),
  ),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
});
