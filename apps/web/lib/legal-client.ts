import type {
  DeliverableKind,
  DocRole,
  Finding,
  LegalManifest,
  LegalSide,
  LegalWorkType,
  MatterDocCard,
  VerifyReport,
} from "@agentforge/core/legal";
import { DELIVERABLE_KINDS, DOC_ROLES, LEGAL_WORK_TYPES } from "@agentforge/core/legal";
import { z } from "zod";
import { apiFetch, isElectron } from "./api-client";
import { saveBlob } from "./artifacts-client";

/** Mirrors the host message for a non-docx upload (contract §3). */
export const LEGAL_DOCX_ONLY_MESSAGE =
  "Only .docx files are accepted in v1. Convert PDF or other formats to .docx first.";
/** Per-file cap that matches the desktop IPC envelope (contract §3). */
export const LEGAL_FILE_MAX_BYTES = 25 * 1024 * 1024;
export const LEGAL_ACCEPT = ".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const BASE = "/api/v1/legal";

export function legalRunStreamPath(matterId: string): string {
  return `${BASE}/matters/${encodeURIComponent(matterId)}/run/stream`;
}

/** Bytes for a persisted deliverable; the host sets Content-Disposition with the filename. */
export function legalArtifactFilePath(artifactId: string): string {
  return `/api/v1/artifacts/${encodeURIComponent(artifactId)}/file`;
}

// ---------------------------------------------------------------------------
// Response schemas. Loose on nested detail, strict on what the UI depends on.
// ---------------------------------------------------------------------------

const sideSchema = z.object({ role: z.string(), party: z.string(), counterparty: z.string() });

const docCardSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string().default(""),
  mime: z.string().default(""),
  bytes: z.number().default(0),
  sha256: z.string().default(""),
  role: z.enum(DOC_ROLES).catch("context"),
  status: z.enum(["read", "skipped"]).catch("read"),
  skipReason: z.string().optional(),
  paragraphs: z.number().default(0),
  words: z.number().default(0),
  insertions: z.number().default(0),
  deletions: z.number().default(0),
  definedTerms: z.number().default(0),
  preview: z.string().default(""),
});

const matterSchema = z.object({
  id: z.string(),
  workspaceId: z.string().default(""),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  side: sideSchema,
  workType: z.enum(LEGAL_WORK_TYPES).catch("review"),
  deliverables: z.array(z.enum(DELIVERABLE_KINDS).catch("issues-memo")).default([]),
  instructions: z.string().default(""),
  playbookId: z.string().nullable().default(null),
  author: z.string().default(""),
  addressee: z.string().default(""),
  firm: z.string().default(""),
  docs: z.array(docCardSchema).default([]),
  priorMatterId: z.string().nullable().default(null),
  lastRunId: z.string().nullable().default(null),
});

const citationSchema = z.object({ doc: z.string(), ref: z.string() });

const findingSchema = z.object({
  id: z.string(),
  clause: z.string(),
  kind: z.enum(["adverse", "deviation", "unmarked-change", "interaction", "missing", "ok"]),
  quote: z.string().default(""),
  quoteAnchor: z.string().nullable().default(null),
  title: z.string(),
  why: z.string().default(""),
  severity: z.enum(["high", "medium", "low"]).catch("low"),
  negotiability: z.enum(["preferred", "fallback", "walk-away", "reserved"]).catch("preferred"),
  proposedText: z.string().nullable().default(null),
  basis: z.array(citationSchema).default([]),
  reservedFor: z.string().nullable().default(null),
  checklist: z.array(z.string()).default([]),
  round: z.number().default(1),
});

const verifyFailureSchema = z.object({
  code: z.string(),
  deliverable: z.string(),
  target: z.string(),
  detail: z.string(),
  autoFixable: z.boolean().default(false),
});

const verifyCheckSchema = z.object({
  code: z.string(),
  passed: z.number(),
  failed: z.number(),
  failures: z.array(verifyFailureSchema).default([]),
});

const verifySchema = z.object({
  round: z.number(),
  codeChecks: z.array(verifyCheckSchema).default([]),
  checklist: z
    .array(z.object({ itemId: z.string(), deliverable: z.string(), pass: z.boolean(), reason: z.string() }))
    .default([]),
  concessions: z
    .array(z.object({ clause: z.string(), detail: z.string(), disposition: z.enum(["fix", "market", "reserved"]) }))
    .default([]),
  documentsSkipped: z.array(z.object({ doc: z.string(), reason: z.string() })).default([]),
  openForHuman: z.array(z.object({ clause: z.string(), detail: z.string() })).default([]),
  ok: z.boolean(),
});

const manifestSchema = z.object({
  harness: z.string().default("agentforge-legal/1"),
  matterId: z.string(),
  createdAt: z.string().default(""),
  side: sideSchema,
  workType: z.enum(LEGAL_WORK_TYPES).catch("review"),
  deliverables: z.array(z.string()).default([]),
  playbookId: z.string().nullable().default(null),
  docs: z.array(docCardSchema).default([]),
  models: z.object({ drafting: z.string(), verifier: z.string() }),
  rounds: z
    .array(z.object({ round: z.number(), verify: verifySchema, edits: z.array(z.unknown()).default([]) }))
    .default([]),
  maxRounds: z.number().default(1),
  findingsCount: z.number().default(0),
  status: z.enum(["running", "complete", "complete-with-failures", "cancelled", "failed"]).catch("complete"),
});

const artifactRefSchema = z.object({
  kind: z.enum(DELIVERABLE_KINDS),
  artifactId: z.string(),
  filename: z.string(),
});

const runSummarySchema = z.object({
  runId: z.string(),
  manifest: manifestSchema,
  findings: z.array(findingSchema).default([]),
  verify: verifySchema.nullable().default(null),
  artifacts: z.array(artifactRefSchema).default([]),
});

const runRecordSchema = z.object({
  id: z.string(),
  matterId: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().nullable().default(null),
  manifest: manifestSchema,
  findings: z.array(findingSchema).default([]),
  verify: verifySchema.nullable().default(null),
  artifacts: z.array(artifactRefSchema).default([]),
  error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
});

const playbookSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  contractType: z.string().default(""),
  itemCount: z.number().default(0),
});

export type LegalMatterRecord = Omit<z.infer<typeof matterSchema>, "docs" | "side"> & {
  side: LegalSide;
  docs: MatterDocCard[];
};
export type LegalArtifactRef = z.infer<typeof artifactRefSchema>;
export type LegalRunSummary = {
  runId: string;
  manifest: LegalManifest;
  findings: Finding[];
  verify: VerifyReport | null;
  artifacts: LegalArtifactRef[];
};
export type LegalRunRecord = LegalRunSummary & {
  matterId: string;
  startedAt: number;
  finishedAt: number | null;
  error: { code: string; message: string } | null;
};
export type LegalPlaybookSummary = z.infer<typeof playbookSummarySchema>;

export type CreateMatterInput = {
  title: string;
  side: LegalSide;
  workType: LegalWorkType;
  deliverables: DeliverableKind[];
  instructions?: string;
  playbookId?: string | null;
  author?: string;
  addressee?: string;
  firm?: string;
  priorMatterId?: string | null;
};

export type MatterPatch = Partial<Omit<CreateMatterInput, "priorMatterId">> & {
  roles?: { id: string; role: DocRole }[];
};

// ---------------------------------------------------------------------------
// Transport helpers
// ---------------------------------------------------------------------------

function errorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const error = (payload as { error?: { message?: unknown } }).error;
    if (error && typeof error.message === "string" && error.message.trim()) {
      return error.message;
    }
  }
  return fallback;
}

async function readJson(res: Response, fallback: string): Promise<unknown> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(errorMessage(data, fallback));
  }
  return data;
}

function parseWith<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, data: unknown, what: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`The host returned an unexpected ${what}. Refresh and try again.`);
  }
  return result.data;
}

function matterPath(matterId: string): string {
  return `${BASE}/matters/${encodeURIComponent(matterId)}`;
}

function jsonInit(method: "POST" | "PATCH", body: unknown): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

export function parseLegalMatter(data: unknown): LegalMatterRecord {
  return parseWith(matterSchema, data, "matter") as LegalMatterRecord;
}

export function parseLegalRunSummary(data: unknown): LegalRunSummary {
  return parseWith(runSummarySchema, data, "run result") as unknown as LegalRunSummary;
}

/** Same shape as the job.done payload, keyed by `id` instead of `runId`. */
export function parseLegalRunRecord(data: unknown): LegalRunRecord {
  const record = parseWith(runRecordSchema, data, "run record");
  const { id, ...rest } = record;
  return { runId: id, ...rest } as unknown as LegalRunRecord;
}

// ---------------------------------------------------------------------------
// Routes (contract §6)
// ---------------------------------------------------------------------------

export async function createLegalMatter(input: CreateMatterInput): Promise<LegalMatterRecord> {
  const res = await apiFetch(`${BASE}/matters`, jsonInit("POST", input));
  return parseLegalMatter(await readJson(res, "Could not create the matter"));
}

export async function listLegalMatters(): Promise<LegalMatterRecord[]> {
  const res = await apiFetch(`${BASE}/matters`);
  const data = await readJson(res, "Could not list previous matters");
  const list = parseWith(z.object({ matters: z.array(z.unknown()).default([]) }), data, "matter list");
  return list.matters.flatMap((item) => {
    const parsed = matterSchema.safeParse(item);
    return parsed.success ? [parsed.data as LegalMatterRecord] : [];
  });
}

export async function getLegalMatter(matterId: string): Promise<LegalMatterRecord> {
  const res = await apiFetch(matterPath(matterId));
  return parseLegalMatter(await readJson(res, "Could not open that matter"));
}

export async function updateLegalMatter(matterId: string, patch: MatterPatch): Promise<LegalMatterRecord> {
  const res = await apiFetch(matterPath(matterId), jsonInit("PATCH", patch));
  return parseLegalMatter(await readJson(res, "Could not save the matter"));
}

export async function deleteLegalMatter(matterId: string): Promise<void> {
  const res = await apiFetch(matterPath(matterId), { method: "DELETE" });
  await readJson(res, "Could not delete that matter");
}

export function isDocxFile(file: { name: string; type?: string }): boolean {
  return /\.docx$/i.test(file.name);
}

/** One multipart request per file, field "file". Rejects non-docx and oversized files before the network. */
export async function uploadLegalFile(
  matterId: string,
  file: File,
): Promise<{ matter: LegalMatterRecord; card: MatterDocCard }> {
  if (!isDocxFile(file)) {
    throw new Error(LEGAL_DOCX_ONLY_MESSAGE);
  }
  if (file.size > LEGAL_FILE_MAX_BYTES) {
    throw new Error(`${file.name} is over the 25 MB per-file cap.`);
  }
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await apiFetch(`${matterPath(matterId)}/files`, { method: "POST", body: form });
  const data = await readJson(res, `Could not upload ${file.name}`);
  const parsed = parseWith(z.object({ matter: z.unknown(), card: docCardSchema }), data, "upload result");
  return { matter: parseLegalMatter(parsed.matter), card: parsed.card as MatterDocCard };
}

export type UploadProgress = { file: File; index: number; total: number; status: "uploading" | "done" | "failed" };

/**
 * Upload several files sequentially; the callback reports each transition. Stops at the first failure
 * and rethrows so the caller can show which file it was.
 */
export async function uploadLegalFiles(
  matterId: string,
  files: readonly File[],
  onProgress: (progress: UploadProgress) => void,
): Promise<LegalMatterRecord | null> {
  let latest: LegalMatterRecord | null = null;
  for (const [index, file] of files.entries()) {
    onProgress({ file, index, total: files.length, status: "uploading" });
    try {
      latest = (await uploadLegalFile(matterId, file)).matter;
      onProgress({ file, index, total: files.length, status: "done" });
    } catch (err) {
      onProgress({ file, index, total: files.length, status: "failed" });
      throw err;
    }
  }
  return latest;
}

export async function deleteLegalFile(matterId: string, docId: string): Promise<LegalMatterRecord> {
  const res = await apiFetch(`${matterPath(matterId)}/files/${encodeURIComponent(docId)}`, { method: "DELETE" });
  return parseLegalMatter(await readJson(res, "Could not remove that document"));
}

export async function getLegalRun(matterId: string, runId: string): Promise<LegalRunRecord> {
  const res = await apiFetch(`${matterPath(matterId)}/runs/${encodeURIComponent(runId)}`);
  return parseLegalRunRecord(await readJson(res, "Could not open that run"));
}

export async function listLegalPlaybooks(): Promise<LegalPlaybookSummary[]> {
  const res = await apiFetch(`${BASE}/playbooks`);
  const data = await readJson(res, "Could not list playbooks");
  const list = parseWith(z.object({ playbooks: z.array(z.unknown()).default([]) }), data, "playbook list");
  return list.playbooks.flatMap((item) => {
    const parsed = playbookSummarySchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

/** Download a deliverable through the host; on desktop apiFetch already opened the native save dialog. */
export async function downloadLegalArtifact(artifact: LegalArtifactRef): Promise<void> {
  const res = await apiFetch(legalArtifactFilePath(artifact.artifactId));
  if (!res.ok) {
    throw new Error(errorMessage(await res.json().catch(() => null), `Could not download ${artifact.filename}`));
  }
  if (isElectron()) {
    return;
  }
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/)?.[1] ?? artifact.filename;
  saveBlob(await res.blob(), filename);
}
