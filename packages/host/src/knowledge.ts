import { readdirSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "@agentforge/db";
import {
  ApiError,
  assertAllowedEndpointUrl,
  htmlToText,
  isHtmlContent,
  plainToText,
  scanInjection,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { mediaRoot } from "./media-root";
import { fetchPublicHttps } from "./safe-fetch";
import { KNOWLEDGE_TEXT_MAX_CHARS, SOURCE_NAME_MAX, chunkKnowledgeText, sanitizeSourceName } from "./knowledge-text";
import { deleteThroughBackend, indexThroughBackend, retrieveThroughBackend } from "./knowledge/registry";
import type { KnowledgeBackendId, RetrievedChunk, RetrieveResult } from "./knowledge/backend";
import { expandRetrievedChunks } from "./knowledge-expand";
import { removeGraphForSource, sweepOrphanGraph } from "./knowledge-graph-prune";
import { defaultSoul, isLegacyDefaultSoul, type KnowledgeSoul } from "./knowledge-soul";
import { modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";
import { escapeLikePattern, LIKE_ESCAPE } from "./sql-guard";

export { chunkKnowledgeText, knowledgeFtsQuery, sanitizeSourceName } from "./knowledge-text";
export type { RetrievedChunk, RetrieveResult } from "./knowledge/backend";
export { defaultSoul, isLegacyDefaultSoul } from "./knowledge-soul";
export type { KnowledgeSoul } from "./knowledge-soul";

export type KnowledgeMemory = {
  id: string;
  text: string;
  pinned: boolean;
  createdAt: number;
};

/** Where a work card came from. `thread` = Chat, `media` = Images / Videos / Edit, `artifact` = job outputs. */
export type SourceOriginKind = "thread" | "media" | "artifact";

export type SourceOrigin = { kind: SourceOriginKind; id: string };

export type KnowledgeSource = {
  id: string;
  name: string;
  type: string;
  status: "Indexed" | "Indexing" | "Failed";
  chunks: number;
  error?: string | null;
  createdAt: number;
  origin?: SourceOrigin | null;
};

type SourceRow = {
  id: string;
  name: string;
  type: string;
  status: KnowledgeSource["status"];
  chunks: number;
  error: string | null;
  created_at: number;
  origin_kind: string | null;
  origin_id: string | null;
};

const SOURCE_COLUMNS = "id, name, type, status, chunks, error, created_at, origin_kind, origin_id";

function sourceFromRow(row: SourceRow): KnowledgeSource {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    chunks: row.chunks,
    error: row.error,
    createdAt: row.created_at,
    origin:
      row.origin_kind !== null && row.origin_id !== null
        ? { kind: row.origin_kind as SourceOriginKind, id: row.origin_id }
        : null,
  };
}

function workspaceId(tenant: TenantContext): string {
  return tenant.workspaceId;
}

function catalogKnowledgeDefaults(): KnowledgeModels {
  const { defaults } = modeCatalogPayload();
  return {
    embeddingModel: defaults.embedding,
    brainModel: defaults.knowledgeBrain,
    verifierModel: defaults.knowledgeVerifier,
  };
}

export function getKnowledgeModels(tenant: TenantContext): KnowledgeModels {
  const row = sql
    .prepare("SELECT embedding_model, brain_model, verifier_model FROM knowledge_settings WHERE workspace_id = ?")
    .get(workspaceId(tenant)) as { embedding_model: string; brain_model: string; verifier_model: string } | undefined;
  if (!row) {
    return catalogKnowledgeDefaults();
  }
  return {
    embeddingModel: row.embedding_model,
    brainModel: row.brain_model,
    verifierModel: row.verifier_model,
  };
}

export function putKnowledgeModels(tenant: TenantContext, input: Partial<KnowledgeModels>): KnowledgeModels {
  const current = getKnowledgeModels(tenant);
  const next: KnowledgeModels = {
    embeddingModel: (input.embeddingModel?.trim() || current.embeddingModel).trim(),
    brainModel: (input.brainModel?.trim() || current.brainModel).trim(),
    verifierModel: (input.verifierModel?.trim() || current.verifierModel).trim(),
  };
  sql
    .prepare(
      `INSERT INTO knowledge_settings (workspace_id, embedding_model, brain_model, verifier_model, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         embedding_model = excluded.embedding_model,
         brain_model = excluded.brain_model,
         verifier_model = excluded.verifier_model,
         updated_at = excluded.updated_at`,
    )
    .run(workspaceId(tenant), next.embeddingModel, next.brainModel, next.verifierModel, Date.now());
  return next;
}

export function getSoul(tenant: TenantContext): KnowledgeSoul {
  const row = sql
    .prepare("SELECT name, role, voice, rules FROM knowledge_soul WHERE workspace_id = ?")
    .get(workspaceId(tenant)) as { name: string; role: string; voice: string; rules: string } | undefined;
  if (!row) {
    return defaultSoul();
  }
  let rules: string[] = [];
  try {
    const parsed = JSON.parse(row.rules) as unknown;
    rules = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    rules = [];
  }
  const stored: KnowledgeSoul = { name: row.name, role: row.role, voice: row.voice, rules };
  // Upgrade on read, not on write: a desk whose row is byte-for-byte the old default never chose
  // it (the Knowledge page saves the default verbatim when Save is pressed unedited), so it gets
  // the product's own Soul. One edited field and the row is the owner's — returned untouched.
  return isLegacyDefaultSoul(stored) ? defaultSoul() : stored;
}

export function putSoul(tenant: TenantContext, input: KnowledgeSoul): KnowledgeSoul {
  const fallback = defaultSoul();
  const name = input.name.trim() || fallback.name;
  const role = input.role.trim() || fallback.role;
  const voice = input.voice.trim() || fallback.voice;
  const rules = input.rules.map((rule) => rule.trim()).filter(Boolean);
  sql
    .prepare(
      `INSERT INTO knowledge_soul (workspace_id, name, role, voice, rules, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id) DO UPDATE SET
         name = excluded.name, role = excluded.role, voice = excluded.voice,
         rules = excluded.rules, updated_at = excluded.updated_at`,
    )
    .run(workspaceId(tenant), name, role, voice, JSON.stringify(rules), Date.now());
  return { name, role, voice, rules };
}

export function listMemories(tenant: TenantContext): KnowledgeMemory[] {
  const rows = sql
    .prepare(
      "SELECT id, text, pinned, created_at FROM knowledge_memories WHERE workspace_id = ? ORDER BY pinned DESC, created_at DESC",
    )
    .all(workspaceId(tenant)) as Array<{ id: string; text: string; pinned: number; created_at: number }>;
  return rows.map((row) => ({
    id: row.id,
    text: row.text,
    pinned: Boolean(row.pinned),
    createdAt: row.created_at,
  }));
}

export function addMemory(tenant: TenantContext, text: string, pinned = false): KnowledgeMemory {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ApiError("invalid_request", "Memory text is required", 400);
  }
  const id = crypto.randomUUID();
  const createdAt = Date.now();
  sql
    .prepare("INSERT INTO knowledge_memories (id, workspace_id, text, pinned, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, workspaceId(tenant), trimmed, pinned ? 1 : 0, createdAt);
  return { id, text: trimmed, pinned, createdAt };
}

export function deleteMemory(tenant: TenantContext, id: string): void {
  sql.prepare("DELETE FROM knowledge_memories WHERE workspace_id = ? AND id = ?").run(workspaceId(tenant), id);
}

export function listSources(tenant: TenantContext): KnowledgeSource[] {
  const rows = sql
    .prepare(`SELECT ${SOURCE_COLUMNS} FROM knowledge_sources WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId(tenant)) as SourceRow[];
  return rows.map(sourceFromRow);
}

/** The source a piece of work already produced, if any (idempotent ingest key). */
export function findSourceByOrigin(tenant: TenantContext, origin: SourceOrigin): KnowledgeSource | null {
  const row = sql
    .prepare(
      `SELECT ${SOURCE_COLUMNS} FROM knowledge_sources WHERE workspace_id = ? AND origin_kind = ? AND origin_id = ?`,
    )
    .get(workspaceId(tenant), origin.kind, origin.id) as SourceRow | undefined;
  return row ? sourceFromRow(row) : null;
}

// Extraction (text, PDF, DOCX) with its own size/time caps and `pdf_*` / `docx_*` error codes moved to
// `knowledge-extract.ts`; the import sits here, where the old inline parser was, to keep that visible.
import { extractText } from "./knowledge-extract";
import { log } from "./log";

export type IndexSourceInput = {
  /** Reusing an existing id replaces that source's row, chunks, and vectors (work-card re-index). */
  id: string;
  name: string;
  type: string;
  text: string;
  origin?: SourceOrigin | null;
};

const INSERT_SOURCE = `INSERT INTO knowledge_sources
  (id, workspace_id, name, type, status, chunks, error, created_at, origin_kind, origin_id, external_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * The retrieval backend's handle on a source, read before the row is replaced or deleted.
 *
 * A re-index rewrites the row, and a delete drops it, but the backend's own document outlives both
 * — it is a separate store, reached by a later (possibly remote) call. Losing the handle in between
 * would leave that document orphaned: still holding the old text, no longer reachable from here.
 */
function externalIdOf(workspaceId: string, sourceId: string): string | null {
  try {
    const row = sql
      .prepare("SELECT external_id FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
      .get(workspaceId, sourceId) as { external_id: string | null } | undefined;
    return row?.external_id ?? null;
  } catch {
    return null;
  }
}

const NO_TEXT = "No extractable text";

let lastCreatedAt = 0;

/**
 * Strictly increasing so two writes in one millisecond never share a version stamp (vector guard).
 * Exported for the re-index rewrite, which stamps a source row and its vectors in one transaction.
 */
export function nextCreatedAt(): number {
  const next = Math.max(Date.now(), lastCreatedAt + 1);
  lastCreatedAt = next;
  return next;
}

/** One transaction: drop the old row + chunks for this id, write the new row + chunks. */
function replaceSourceRows(
  tenant: TenantContext,
  input: Omit<IndexSourceInput, "text">,
  chunks: string[],
  error: string | null,
  createdAt: number,
): void {
  const ws = workspaceId(tenant);
  const status: KnowledgeSource["status"] = error ? "Failed" : "Indexed";
  const insertChunk = sql.prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)");
  // Carried across the replace so the backend can delete-then-create its own document. A folded
  // duplicate's handle is used only when this id has none; when *both* rows had one the folded
  // document would be left behind in the backend, holding our text and reachable by nothing, so it
  // is collected here and deleted after the transaction commits.
  let carriedExternalId = externalIdOf(ws, input.id);
  let orphanedExternalId: string | null = null;
  const tx = sql.transaction(() => {
    if (input.origin) {
      // Another row may already own this origin (a concurrent writer for the same thread / media).
      // Fold it into this write so the unique origin index never throws and no card is lost.
      const owner = sql
        .prepare("SELECT id FROM knowledge_sources WHERE workspace_id = ? AND origin_kind = ? AND origin_id = ? AND id != ?")
        .get(ws, input.origin.kind, input.origin.id, input.id) as { id: string } | undefined;
      if (owner) {
        const ownerExternalId = externalIdOf(ws, owner.id);
        if (carriedExternalId === null) {
          carriedExternalId = ownerExternalId;
        } else if (ownerExternalId && ownerExternalId !== carriedExternalId) {
          orphanedExternalId = ownerExternalId;
        }
        sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, owner.id);
        sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, owner.id);
        sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, owner.id);
      }
    }
    sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, input.id);
    sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, input.id);
    sql
      .prepare(INSERT_SOURCE)
      .run(
        input.id,
        ws,
        input.name,
        input.type,
        status,
        chunks.length,
        error,
        createdAt,
        input.origin?.kind ?? null,
        input.origin?.id ?? null,
        carriedExternalId,
      );
    for (const chunk of chunks) {
      insertChunk.run(input.id, ws, chunk);
    }
  });
  // Reads then writes, so it takes the write lock up front (a deferred upgrade races other writers).
  tx.immediate();
  if (orphanedExternalId) {
    // The folded row is gone from SQLite, so nothing here can ever look this handle up again. The
    // delete is queued now or never — and "never" means the old card keeps answering searches.
    forgetInBackend(tenant, input.id, orphanedExternalId);
  }
}

/**
 * Forget one source in the retrieval backend. SQLite rows are dropped by the caller's transaction;
 * this is the index side, which is remote (and therefore async) from Phase 3 on. Never throws.
 */
function forgetInBackend(tenant: TenantContext, sourceId: string, externalId?: string | null): void {
  const warn = (error: unknown) => {
    log.warn("knowledge_backend_delete_failed", {
      sourceId,
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
  };
  try {
    // `.catch` alone is not enough: a backend whose delete is not `async` throws before it returns a
    // promise, and that throw would surface out of `deleteSource` / the orphan sweep.
    void deleteThroughBackend(tenant, sourceId, externalId).catch(warn);
  } catch (error) {
    warn(error);
  }
}

const UNTITLED_SOURCE = "Untitled source";

/**
 * Every entry point (file, URL, paste, work card) funnels its name through here before it reaches
 * a row, so the `[n] <name>` citation marker can never be forged from an upload filename or a
 * remote `<title>`. Returns a new object; the caller's input is never mutated.
 */
function withSafeName<T extends { name: string }>(input: T): T {
  return { ...input, name: sanitizeSourceName(input.name) || UNTITLED_SOURCE };
}

/** Chunk, store, and index one source. Replaces any earlier source with the same id. */
export async function indexKnowledgeSource(tenant: TenantContext, raw: IndexSourceInput): Promise<KnowledgeSource> {
  const input = withSafeName(raw);
  const chunks = chunkKnowledgeText(input.text);
  const createdAt = nextCreatedAt();
  const base = { id: input.id, name: input.name, type: input.type, createdAt, origin: input.origin ?? null };
  if (chunks.length === 0) {
    replaceSourceRows(tenant, input, [], NO_TEXT, createdAt);
    forgetInBackend(tenant, input.id);
    return { ...base, status: "Failed", chunks: 0, error: NO_TEXT };
  }
  replaceSourceRows(tenant, input, chunks, null, createdAt);
  const models = getKnowledgeModels(tenant);
  // FTS rows are already committed above, for every backend: the dual write is what keeps a card
  // findable when the selected engine is down. Only the vector / hybrid half is delegated.
  await indexThroughBackend(tenant, { id: input.id, name: input.name, createdAt }, chunks, models.embeddingModel);
  return { ...base, status: "Indexed", chunks: chunks.length };
}

/** Record a source that could not be indexed. The work that produced it still succeeded. */
export function markSourceFailed(
  tenant: TenantContext,
  raw: Omit<IndexSourceInput, "text">,
  reason: string,
): KnowledgeSource {
  const input = withSafeName(raw);
  const createdAt = nextCreatedAt();
  replaceSourceRows(tenant, input, [], reason, createdAt);
  forgetInBackend(tenant, input.id);
  return {
    id: input.id,
    name: input.name,
    type: input.type,
    status: "Failed",
    chunks: 0,
    error: reason,
    createdAt,
    origin: input.origin ?? null,
  };
}

function injectionGuardBypass(tenant: TenantContext): boolean {
  try {
    return loadSettings(tenant.workspaceId).injectionGuardBypass === true;
  } catch {
    return false;
  }
}

/**
 * Manual sources (paste, upload, URL) go through the same injection guard as auto-ingested cards:
 * anything indexed here is served back as trusted `## Retrieved sources` to every later Chat. A hit
 * records a `Failed` row with the rule instead of indexing; the owner bypass in Settings still applies.
 *
 * The name is scanned too: it becomes the `[n] <name>` citation line, and an upload filename or a
 * remote `<title>` is attacker-controlled in exactly the same way the body is.
 */
function injectionRule(tenant: TenantContext, name: string, text: string): string | null {
  if (injectionGuardBypass(tenant)) {
    return null;
  }
  // The raw name, not the sanitized one: stripping a leading `###` must not also strip the rule that
  // would have caught it.
  return (scanInjection(name) ?? scanInjection(text))?.rule ?? null;
}

function indexSource(
  tenant: TenantContext,
  id: string,
  name: string,
  type: string,
  text: string,
): Promise<KnowledgeSource> {
  const rule = injectionRule(tenant, name, text);
  if (rule) {
    return Promise.resolve(markSourceFailed(tenant, { id, name, type }, `injection_blocked (rule: ${rule})`));
  }
  return indexKnowledgeSource(tenant, { id, name, type, text });
}

/** Where `addFileSource` keeps the raw upload, so a delete can find the bytes again. */
function uploadDir(tenant: TenantContext): string {
  return path.join(mediaRoot(), "knowledge", tenant.organizationId);
}

/**
 * Drop the raw bytes an upload left on disk.
 *
 * `addFileSource` writes every upload under `<mediaRoot>/knowledge/<organizationId>/<id>-<name>`,
 * and that directory is organization-scoped while the source row is workspace-scoped: an owner who
 * removes a source believing they removed the document has to be right about that. The stored name
 * is mangled (`[^\w.-]` collapsed) so it is found by its `<id>-` prefix rather than rebuilt.
 *
 * Sync on purpose: `deleteSource` answers the route synchronously, and a delete that reports success
 * before the bytes are gone is the bug this closes. A missing directory or file is not an error.
 */
function removeStoredUpload(tenant: TenantContext, sourceId: string): number {
  const dir = uploadDir(tenant);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0; // ENOENT: this desk has never had a file upload, or it was cleaned up already.
  }
  let removed = 0;
  for (const entry of entries) {
    if (!entry.startsWith(`${sourceId}-`)) {
      continue;
    }
    try {
      rmSync(path.join(dir, entry), { force: true });
      removed += 1;
    } catch (error) {
      log.warn("knowledge_stored_upload_not_removed", {
        sourceId,
        detail: error instanceof Error ? error.message.slice(0, 120) : "error",
      });
    }
  }
  return removed;
}

/**
 * Index one uploaded file.
 *
 * Failure is an HTTP failure, not a tombstone: a format we cannot read (`unsupported_content_type`),
 * a supported format that will not parse (`pdf_*` / `docx_*`) and an upload that carries injection
 * text all leave as a structured 4xx with no row and no stored bytes. `201 Created` used to answer a
 * `Failed` row, which reads as success to any client that is not the Knowledge page.
 *
 * The injection scan runs before the write so a blocked upload never leaves its bytes on disk.
 */
export async function addFileSource(
  tenant: TenantContext,
  file: { filename: string; mime: string; bytes: Uint8Array },
): Promise<KnowledgeSource> {
  const id = crypto.randomUUID();
  const text = await extractText(file.filename, file.mime, Buffer.from(file.bytes));
  const rule = injectionRule(tenant, file.filename, text);
  if (rule) {
    throw new ApiError(
      "injection_blocked",
      `This file was not indexed: it carries prompt-injection text (rule: ${rule}).`,
      400,
    );
  }
  const relative = `knowledge/${tenant.organizationId}/${id}-${file.filename.replace(/[^\w.-]+/g, "_")}`;
  const full = path.join(mediaRoot(), relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(file.bytes));
  return indexKnowledgeSource(tenant, { id, name: file.filename, type: "File", text });
}

/** Whole page for indexing; the 1.5 MB fetch cap already bounds it. Shared with paste and file text. */
const URL_SOURCE_MAX_CHARS = KNOWLEDGE_TEXT_MAX_CHARS;

export async function addUrlSource(tenant: TenantContext, url: string): Promise<KnowledgeSource> {
  const trimmed = url.trim();
  assertAllowedEndpointUrl(trimmed);
  const parsed = new URL(trimmed);
  if (parsed.protocol !== "https:") {
    throw new ApiError("invalid_endpoint", "Knowledge URLs must be HTTPS", 400);
  }
  // Redirects are followed by hand so every hop stays public HTTPS (no loopback / private ranges).
  const res = await fetchPublicHttps(trimmed);
  if (res.status < 200 || res.status >= 300) {
    throw new ApiError("invalid_request", `Could not fetch URL (${res.status})`, 400);
  }
  const raw = res.body.toString("utf8");
  const page = isHtmlContent(res.contentType, raw)
    ? htmlToText(raw, { maxChars: URL_SOURCE_MAX_CHARS })
    : plainToText(raw, { maxChars: URL_SOURCE_MAX_CHARS });
  return indexSource(tenant, crypto.randomUUID(), page.title || trimmed, "URL", page.text);
}

/** Source type labels a caller may set on pasted text. Anything else falls back to "Paste". */
export const PASTED_SOURCE_TYPES = ["Paste", "Dossier", "Analysis", "Brief", "Memo", "Playbook"] as const;

/** Source types written automatically when a mode finishes a piece of work (the ingest loop). */
export const WORK_SOURCE_TYPES = [
  "Chat",
  "Documents",
  "Research",
  "Finance",
  "Data",
  "Market",
  "Images",
  "Videos",
  "Music",
  "Presentation",
  "Edit",
  "Legal",
  "Meeting",
] as const;
export type WorkSourceType = (typeof WORK_SOURCE_TYPES)[number];

/** Every source type the Sources list can show. */
export const KNOWLEDGE_SOURCE_TYPES = ["File", "URL", ...PASTED_SOURCE_TYPES, ...WORK_SOURCE_TYPES] as const;
export type PastedSourceType = (typeof PASTED_SOURCE_TYPES)[number];
export const PASTED_SOURCE_MAX_CHARS = KNOWLEDGE_TEXT_MAX_CHARS;
/**
 * Source names show in the Sources list and become the `[n] <name>` citation marker, so the pasted
 * cap is the same one every other entry point gets (`sanitizeSourceName`).
 */
export const PASTED_SOURCE_NAME_MAX = SOURCE_NAME_MAX;

export function pastedSourceType(value: unknown): PastedSourceType {
  return typeof value === "string" && (PASTED_SOURCE_TYPES as readonly string[]).includes(value)
    ? (value as PastedSourceType)
    : "Paste";
}

export async function addPastedSource(
  tenant: TenantContext,
  name: string,
  text: string,
  type: PastedSourceType = "Paste",
): Promise<KnowledgeSource> {
  if (text.length > PASTED_SOURCE_MAX_CHARS) {
    throw new ApiError("invalid_request", "Pasted text exceeds the 2 MB cap", 413);
  }
  const trimmedName = name.trim().slice(0, PASTED_SOURCE_NAME_MAX).trim() || "Pasted notes";
  return indexSource(tenant, crypto.randomUUID(), trimmedName, type, text);
}

/**
 * Everything one source leaves behind, in the caller's transaction: its chunks, its vectors, its
 * graph node and edges, and its retrieval rows. The row itself is the caller's to delete, because
 * `deleteSource` and the orphan sweep disagree about how they select it.
 */
function dropSourceTraces(tenant: TenantContext, sourceId: string): void {
  const ws = workspaceId(tenant);
  sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, sourceId);
  sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, sourceId);
  // The graph and the retrieval counter are projections that used to outlive their source: a deleted
  // card stayed drawable forever and the Retrieved stage could only go up. Same transaction as the
  // row, so the projection can never survive the thing it projects.
  removeGraphForSource(tenant, sourceId);
}

export function deleteSource(tenant: TenantContext, id: string): boolean {
  const ws = workspaceId(tenant);
  // Read before the transaction: afterwards there is no row left to read it from, and the index
  // side of the delete has not run yet.
  const externalId = externalIdOf(ws, id);
  const tx = sql.transaction(() => {
    dropSourceTraces(tenant, id);
    return sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, id).changes > 0;
  });
  const removed = tx.immediate();
  if (removed) {
    // The SQLite rows are gone; tell the retrieval index too (a no-op repeat for the builtin backend,
    // a network call once the index lives outside this file).
    forgetInBackend(tenant, id, externalId);
    // And the raw upload, if this source was a file. Nothing else ever reads it once the row is gone.
    removeStoredUpload(tenant, id);
  }
  return removed;
}

/**
 * How the sweep decides whether a work card's subject still exists, one clause per origin kind.
 *
 * `media` is organization-scoped (the `media` table has no workspace column) while everything else
 * on the knowledge path is workspace-scoped; the card is still only swept inside its own workspace.
 */
const ORIGIN_OWNERS: Readonly<
  Record<SourceOriginKind, { select: string; param: (tenant: TenantContext) => string }>
> = {
  thread: { select: "SELECT id FROM threads WHERE workspace_id = ?", param: (tenant) => tenant.workspaceId },
  artifact: { select: "SELECT id FROM artifacts WHERE workspace_id = ?", param: (tenant) => tenant.workspaceId },
  media: { select: "SELECT id FROM media WHERE organization_id = ?", param: (tenant) => tenant.organizationId },
};

type OrphanRow = { id: string; external_id: string | null };

/**
 * Work cards of one origin kind whose subject is gone. `null` — never an empty list — when the owner
 * table cannot be read, so an unreadable table can never be mistaken for "nothing owns these rows".
 */
function orphansOfKind(tenant: TenantContext, kind: SourceOriginKind): OrphanRow[] | null {
  const owner = ORIGIN_OWNERS[kind];
  try {
    return sql
      .prepare(
        `SELECT id, external_id FROM knowledge_sources
         WHERE workspace_id = ? AND origin_kind = ?
           AND origin_id NOT IN (${owner.select})`,
      )
      .all(workspaceId(tenant), kind, owner.param(tenant)) as OrphanRow[];
  } catch (error) {
    log.warn("knowledge_orphan_sweep_skipped", {
      kind,
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
    return null;
  }
}

/**
 * Drop work cards whose subject is gone — a deleted thread, a deleted generated image or clip, a
 * deleted job artifact — plus the graph and retrieval rows they left behind.
 *
 * This is the belt to the cascade's braces. It covers three holes the thread-only sweep did not:
 * `media` cards had *no* removal path at all (nothing ever called `deleteSourceByOrigin` with
 * `kind: "media"`), `artifact` cards were only removed by the artifact route, and dataset / matter
 * deletes reach their cards through the artifacts they own, which they now delete first.
 *
 * Cheap, workspace-scoped, one transaction; called from GET /api/v1/knowledge and after a dataset
 * or matter delete. `sweepOrphanThreadSources` is the old name and still works.
 */
export function sweepOrphanSources(tenant: TenantContext): number {
  const ws = workspaceId(tenant);
  const found = (Object.keys(ORIGIN_OWNERS) as SourceOriginKind[]).flatMap((kind) => orphansOfKind(tenant, kind) ?? []);
  const tx = sql.transaction(() => {
    for (const row of found) {
      dropSourceTraces(tenant, row.id);
      sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, row.id);
    }
    return found;
  });
  const removed = tx.immediate();
  for (const row of removed) {
    forgetInBackend(tenant, row.id, row.external_id);
    removeStoredUpload(tenant, row.id);
  }
  // Rows written before the cascade existed have no source row left to sweep — only a node, an edge
  // or a retrieval. The owner's desk carried 18 graph nodes against one live source; this is the
  // repair pass that makes the loop chart describe the knowledge base that actually exists.
  sweepOrphanGraph(tenant);
  return removed.length;
}

/**
 * The sweep's old, thread-only name. Kept so the `GET /api/v1/knowledge` call site picks up the
 * generalised sweep without a handler change; new callers should say `sweepOrphanSources`.
 */
export function sweepOrphanThreadSources(tenant: TenantContext): number {
  return sweepOrphanSources(tenant);
}

/** Remove the work card of a thread / media / artifact that was deleted, so it is never retrieved again. */
export function deleteSourceByOrigin(tenant: TenantContext, origin: SourceOrigin): boolean {
  const existing = findSourceByOrigin(tenant, origin);
  return existing ? deleteSource(tenant, existing.id) : false;
}

/** Meta keys that tie an artifact to the record it was produced for. */
export type ArtifactOwnerKey = "datasetId" | "matterId";

type SqlLike = Pick<typeof sql, "prepare">;

/**
 * Delete every artifact one dataset or matter produced.
 *
 * Data and Legal cards carry `origin: { kind: "artifact" }`, so removing the dataset or the matter
 * has to reach the artifacts first — otherwise the analysis keeps answering Chat about numbers that
 * are gone, and a matter the owner deleted keeps feeding its red flags into every later turn. The
 * caller runs `sweepOrphanSources` afterwards, which collects the cards these rows owned.
 *
 * Matched on the `meta` JSON both ways: a `LIKE` on the serialized pair narrows the scan without
 * needing JSON1, then the parsed value has to agree before anything is deleted.
 */
export function deleteArtifactsByOwner(
  tenant: TenantContext,
  key: ArtifactOwnerKey,
  ownerId: string,
  db: SqlLike = sql,
): number {
  if (!ownerId) {
    return 0;
  }
  try {
    // `ownerId` is request text: a `%` or `_` in it is a LIKE wildcard, so the pattern is escaped
    // and the statement names the escape character. Without both, an id of `%` shortlists every
    // artifact in the workspace and the exact-meta check below is the only thing left guarding it.
    const needle = escapeLikePattern(`${JSON.stringify(key)}:${JSON.stringify(ownerId)}`);
    const rows = db
      .prepare(`SELECT id, meta FROM artifacts WHERE workspace_id = ? AND meta LIKE ? ESCAPE '${LIKE_ESCAPE}'`)
      .all(workspaceId(tenant), `%${needle}%`) as Array<{
      id: string;
      meta: string;
    }>;
    const owned = rows.filter((row) => {
      try {
        return (JSON.parse(row.meta) as Record<string, unknown>)[key] === ownerId;
      } catch {
        return false;
      }
    });
    const statement = db.prepare("DELETE FROM artifacts WHERE workspace_id = ? AND id = ?");
    for (const row of owned) {
      statement.run(workspaceId(tenant), row.id);
    }
    return owned.length;
  } catch (error) {
    log.warn("knowledge_owned_artifacts_not_removed", {
      originKind: key,
      ownerId,
      detail: error instanceof Error ? error.message.slice(0, 120) : "error",
    });
    return 0;
  }
}

export type RetrieveOptions = {
  /** Sources never returned, e.g. the card written from the thread that is asking. */
  excludeSourceIds?: string[];
  /**
   * Phase 4 graph expansion. Off unless true: one hop over `covers` may add up to 2 sibling
   * chunks when the top hit is weak. Chat does not pass this yet.
   */
  expand?: boolean;
};

/** Chunks that answer this query, each carrying its source id / name / score so it can be cited. */
export async function retrieveChunks(
  tenant: TenantContext,
  query: string,
  limit = 4,
  options: RetrieveOptions = {},
): Promise<RetrieveResult> {
  const result = await retrieveThroughBackend(tenant, query, {
    limit,
    excludeSourceIds: options.excludeSourceIds ?? [],
  });
  return expandRetrievedChunks(tenant, result, {
    expand: options.expand === true,
    excludeSourceIds: options.excludeSourceIds,
  });
}

export type KnowledgeInjectionOptions = {
  /** The Chat thread asking. Its own work card is never retrieved back into it (anti-loop). */
  excludeThreadId?: string;
};

function excludedSourceIds(tenant: TenantContext, options: KnowledgeInjectionOptions): string[] {
  if (!options.excludeThreadId) {
    return [];
  }
  const own = findSourceByOrigin(tenant, { kind: "thread", id: options.excludeThreadId });
  return own ? [own.id] : [];
}

export type KnowledgeInjection = {
  prompt: string;
  parts: { label: string; detail: string; tokens: number }[];
  /** What the prompt was actually given, in citation order. Recorded as the Retrieved loop edge. */
  chunks: RetrievedChunk[];
  /** Which engine served them. Written to `knowledge_retrievals.backend` by the run that used them. */
  backend: KnowledgeBackendId;
};

/**
 * The Sources line in the context popover. It names the engine that actually answered, and says so
 * when that was not the one the desk selected — `3 chunks · weknora` versus
 * `2 chunks · fts (degraded)` — because a silently degraded knowledge base looks exactly like a
 * knowledge base that has stopped knowing things.
 */
export function sourcesDetail(result: RetrieveResult): string {
  const count = result.chunks.length;
  if (result.degraded) {
    return `${count} chunks · ${result.mode === "none" ? "fts" : result.mode} (degraded)`;
  }
  return result.mode === "none" ? `${count} chunks` : `${count} chunks · ${result.mode}`;
}

export async function knowledgeInjection(
  tenant: TenantContext,
  query = "",
  options: KnowledgeInjectionOptions = {},
): Promise<KnowledgeInjection> {
  const soul = getSoul(tenant);
  const memories = listMemories(tenant).filter((item) => item.pinned);
  const retrieved: RetrieveResult = query
    ? await retrieveChunks(tenant, query, 4, { excludeSourceIds: excludedSourceIds(tenant, options) })
    : { chunks: [], mode: "none", backend: "builtin", vectorModel: null };
  const soulBlock = [
    `Name: ${soul.name}`,
    `Role: ${soul.role}`,
    `Voice: ${soul.voice}`,
    soul.rules.length ? `Rules:\n- ${soul.rules.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const memoryBlock = memories.map((item) => `- ${item.text}`).join("\n");
  // `[n] <sourceName>` on its own line: the default Soul rule asks for a citation, so the marker has
  // to name the source, not just number it. Names are already normalized at index time; sanitizing
  // again here keeps rows written by older builds (or by a future backend) from forging a line.
  const retrievedBlock = retrieved.chunks
    .map((chunk, index) => `[${index + 1}] ${sanitizeSourceName(chunk.sourceName) || chunk.sourceId}\n${chunk.body}`)
    .join("\n\n");
  const sections = [
    soulBlock ? `## Soul\n${soulBlock}` : "",
    memoryBlock ? `## Pinned memories\n${memoryBlock}` : "",
    retrievedBlock ? `## Retrieved sources\n${retrievedBlock}` : "",
  ].filter(Boolean);
  const prompt = sections.length ? `\n\n# Workspace knowledge\n${sections.join("\n\n")}` : "";
  const est = (text: string) => Math.ceil(text.trim().length / 4);
  return {
    prompt,
    parts: [
      { label: "Soul", detail: soul.name, tokens: est(soulBlock) },
      { label: "Memories", detail: `${memories.length} pinned`, tokens: est(memoryBlock) },
      { label: "Sources", detail: sourcesDetail(retrieved), tokens: est(retrievedBlock) },
    ],
    chunks: retrieved.chunks,
    backend: retrieved.backend,
  };
}
