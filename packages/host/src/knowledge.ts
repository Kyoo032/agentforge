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
import { getKnowledgeBackend } from "./knowledge/registry";
import type { RetrievedChunk, RetrieveResult } from "./knowledge/backend";
import { modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";

export { chunkKnowledgeText, knowledgeFtsQuery, sanitizeSourceName } from "./knowledge-text";
export type { RetrievedChunk, RetrieveResult } from "./knowledge/backend";

export type KnowledgeSoul = {
  name: string;
  role: string;
  voice: string;
  rules: string[];
};

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

const DEFAULT_SOUL: KnowledgeSoul = {
  name: "Forge",
  role: "Desk assistant for this workspace",
  voice: "Precise, plain-spoken. Cites sources; never pads.",
  rules: ["Cite a source for every factual claim or say it is an estimate."],
};

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
    return { ...DEFAULT_SOUL, rules: [...DEFAULT_SOUL.rules] };
  }
  let rules: string[] = [];
  try {
    const parsed = JSON.parse(row.rules) as unknown;
    rules = Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    rules = [];
  }
  return { name: row.name, role: row.role, voice: row.voice, rules };
}

export function putSoul(tenant: TenantContext, input: KnowledgeSoul): KnowledgeSoul {
  const name = input.name.trim() || DEFAULT_SOUL.name;
  const role = input.role.trim() || DEFAULT_SOUL.role;
  const voice = input.voice.trim() || DEFAULT_SOUL.voice;
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

export type IndexSourceInput = {
  /** Reusing an existing id replaces that source's row, chunks, and vectors (work-card re-index). */
  id: string;
  name: string;
  type: string;
  text: string;
  origin?: SourceOrigin | null;
};

const INSERT_SOURCE = `INSERT INTO knowledge_sources
  (id, workspace_id, name, type, status, chunks, error, created_at, origin_kind, origin_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const NO_TEXT = "No extractable text";

let lastCreatedAt = 0;

/** Strictly increasing so two writes in one millisecond never share a version stamp (vector guard). */
function nextCreatedAt(): number {
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
  const tx = sql.transaction(() => {
    if (input.origin) {
      // Another row may already own this origin (a concurrent writer for the same thread / media).
      // Fold it into this write so the unique origin index never throws and no card is lost.
      const owner = sql
        .prepare("SELECT id FROM knowledge_sources WHERE workspace_id = ? AND origin_kind = ? AND origin_id = ? AND id != ?")
        .get(ws, input.origin.kind, input.origin.id, input.id) as { id: string } | undefined;
      if (owner) {
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
      );
    for (const chunk of chunks) {
      insertChunk.run(input.id, ws, chunk);
    }
  });
  // Reads then writes, so it takes the write lock up front (a deferred upgrade races other writers).
  tx.immediate();
}

/**
 * Forget one source in the retrieval backend. SQLite rows are dropped by the caller's transaction;
 * this is the index side, which is remote (and therefore async) from Phase 3 on. Never throws.
 */
function forgetInBackend(tenant: TenantContext, sourceId: string): void {
  const warn = (error: unknown) => {
    console.warn(
      `knowledge: backend delete failed for ${sourceId} (${error instanceof Error ? error.message.slice(0, 120) : "error"})`,
    );
  };
  try {
    // `.catch` alone is not enough: a backend whose delete is not `async` throws before it returns a
    // promise, and that throw would surface out of `deleteSource` / the orphan sweep.
    void getKnowledgeBackend().deleteSource(tenant, sourceId).catch(warn);
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
  await getKnowledgeBackend().indexSource(
    tenant,
    { id: input.id, name: input.name, createdAt },
    chunks,
    models.embeddingModel,
  );
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

function injectionGuardBypass(): boolean {
  try {
    return loadSettings().injectionGuardBypass === true;
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
function indexSource(
  tenant: TenantContext,
  id: string,
  name: string,
  type: string,
  text: string,
): Promise<KnowledgeSource> {
  const bypass = injectionGuardBypass();
  // The raw name, not the sanitized one: stripping a leading `###` must not also strip the rule that
  // would have caught it.
  const hit = bypass ? null : (scanInjection(name) ?? scanInjection(text));
  if (hit) {
    return Promise.resolve(markSourceFailed(tenant, { id, name, type }, `injection_blocked (rule: ${hit.rule})`));
  }
  return indexKnowledgeSource(tenant, { id, name, type, text });
}

export async function addFileSource(
  tenant: TenantContext,
  file: { filename: string; mime: string; bytes: Uint8Array },
): Promise<KnowledgeSource> {
  const id = crypto.randomUUID();
  let text: string;
  try {
    text = await extractText(file.filename, file.mime, Buffer.from(file.bytes));
  } catch (error) {
    // A supported format that fails to parse (pdf_* / docx_*) is a Failed source with a human
    // reason, like injection_blocked; an unsupported type stays a 400 so the picker can say so.
    if (error instanceof ApiError && /^(pdf|docx)_/.test(error.code)) {
      return markSourceFailed(tenant, { id, name: file.filename, type: "File" }, `${error.code}: ${error.message}`);
    }
    throw error;
  }
  const relative = `knowledge/${tenant.organizationId}/${id}-${file.filename.replace(/[^\w.-]+/g, "_")}`;
  const full = path.join(mediaRoot(), relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(file.bytes));
  return indexSource(tenant, id, file.filename, "File", text);
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
  "Images",
  "Videos",
  "Presentation",
  "Edit",
  "Legal",
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

export function deleteSource(tenant: TenantContext, id: string): boolean {
  const ws = workspaceId(tenant);
  const tx = sql.transaction(() => {
    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, id);
    sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, id);
    return sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, id).changes > 0;
  });
  const removed = tx.immediate();
  if (removed) {
    // The SQLite rows are gone; tell the retrieval index too (a no-op repeat for the builtin backend,
    // a network call once the index lives outside this file).
    forgetInBackend(tenant, id);
  }
  return removed;
}

/**
 * Drop Chat cards whose thread is gone (a delete that raced the cascade, or rows left by older builds).
 * Cheap, workspace-scoped, one transaction; called from GET /api/v1/knowledge.
 */
export function sweepOrphanThreadSources(tenant: TenantContext): number {
  const ws = workspaceId(tenant);
  const tx = sql.transaction(() => {
    const orphans = sql
      .prepare(
        `SELECT id FROM knowledge_sources
         WHERE workspace_id = ? AND origin_kind = 'thread'
           AND origin_id NOT IN (SELECT id FROM threads WHERE workspace_id = ?)`,
      )
      .all(ws, ws) as Array<{ id: string }>;
    for (const row of orphans) {
      sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, row.id);
      sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, row.id);
      sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ws, row.id);
    }
    return orphans.map((row) => row.id);
  });
  const removed = tx.immediate();
  for (const id of removed) {
    forgetInBackend(tenant, id);
  }
  return removed.length;
}

/** Remove the work card of a thread / media / artifact that was deleted, so it is never retrieved again. */
export function deleteSourceByOrigin(tenant: TenantContext, origin: SourceOrigin): boolean {
  const existing = findSourceByOrigin(tenant, origin);
  return existing ? deleteSource(tenant, existing.id) : false;
}

export type RetrieveOptions = {
  /** Sources never returned, e.g. the card written from the thread that is asking. */
  excludeSourceIds?: string[];
};

/** Chunks that answer this query, each carrying its source id / name / score so it can be cited. */
export function retrieveChunks(
  tenant: TenantContext,
  query: string,
  limit = 4,
  options: RetrieveOptions = {},
): Promise<RetrieveResult> {
  return getKnowledgeBackend().retrieve(tenant, query, {
    limit,
    excludeSourceIds: options.excludeSourceIds ?? [],
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
};

export async function knowledgeInjection(
  tenant: TenantContext,
  query = "",
  options: KnowledgeInjectionOptions = {},
): Promise<KnowledgeInjection> {
  const soul = getSoul(tenant);
  const memories = listMemories(tenant).filter((item) => item.pinned);
  const retrieved: RetrieveResult = query
    ? await retrieveChunks(tenant, query, 4, { excludeSourceIds: excludedSourceIds(tenant, options) })
    : { chunks: [], mode: "none", vectorModel: null };
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
  const count = retrieved.chunks.length;
  const sourcesDetail = retrieved.mode === "none" ? `${count} chunks` : `${count} chunks · ${retrieved.mode}`;
  return {
    prompt,
    parts: [
      { label: "Soul", detail: soul.name, tokens: est(soulBlock) },
      { label: "Memories", detail: `${memories.length} pinned`, tokens: est(memoryBlock) },
      { label: "Sources", detail: sourcesDetail, tokens: est(retrievedBlock) },
    ],
    chunks: retrieved.chunks,
  };
}
