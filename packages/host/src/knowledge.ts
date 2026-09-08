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
import { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";
import { deleteVectorsForSource, indexSourceVectors, retrieveVectorChunks } from "./knowledge-embed";
import { modeCatalogPayload } from "./selectable-models";
import { loadSettings } from "./settings-store";

export { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";

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

function extractText(name: string, mime: string, bytes: Buffer): string {
  const lower = name.toLowerCase();
  const textLike =
    mime.startsWith("text/") ||
    mime === "application/json" ||
    lower.endsWith(".txt") ||
    lower.endsWith(".md") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json");
  if (!textLike) {
    throw new ApiError("unsupported_content_type", "v1 indexes .txt, .md, .csv, and .json only", 400);
  }
  return bytes.toString("utf8");
}

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
  tx();
}

/** Chunk, store, and embed one source. Replaces any earlier source with the same id. */
export async function indexKnowledgeSource(tenant: TenantContext, input: IndexSourceInput): Promise<KnowledgeSource> {
  const chunks = chunkKnowledgeText(input.text);
  const createdAt = nextCreatedAt();
  const base = { id: input.id, name: input.name, type: input.type, createdAt, origin: input.origin ?? null };
  if (chunks.length === 0) {
    replaceSourceRows(tenant, input, [], NO_TEXT, createdAt);
    deleteVectorsForSource(tenant, input.id);
    return { ...base, status: "Failed", chunks: 0, error: NO_TEXT };
  }
  replaceSourceRows(tenant, input, chunks, null, createdAt);
  const models = getKnowledgeModels(tenant);
  // `createdAt` ties the vectors to this exact row version: a delete or re-index that lands while
  // the (possibly remote) embed is in flight makes the vector write a no-op instead of an orphan.
  await indexSourceVectors(tenant, input.id, chunks, models.embeddingModel, createdAt);
  return { ...base, status: "Indexed", chunks: chunks.length };
}

/** Record a source that could not be indexed. The work that produced it still succeeded. */
export function markSourceFailed(
  tenant: TenantContext,
  input: Omit<IndexSourceInput, "text">,
  reason: string,
): KnowledgeSource {
  const createdAt = nextCreatedAt();
  replaceSourceRows(tenant, input, [], reason, createdAt);
  deleteVectorsForSource(tenant, input.id);
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
 */
function indexSource(
  tenant: TenantContext,
  id: string,
  name: string,
  type: string,
  text: string,
): Promise<KnowledgeSource> {
  const hit = injectionGuardBypass() ? null : scanInjection(text);
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
  const text = extractText(file.filename, file.mime, Buffer.from(file.bytes));
  const relative = `knowledge/${tenant.organizationId}/${id}-${file.filename.replace(/[^\w.-]+/g, "_")}`;
  const full = path.join(mediaRoot(), relative);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, Buffer.from(file.bytes));
  return indexSource(tenant, id, file.filename, "File", text);
}

/** Whole page for indexing; the 1.5 MB fetch cap already bounds it. */
const URL_SOURCE_MAX_CHARS = 2_000_000;

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
export const PASTED_SOURCE_MAX_CHARS = 2_000_000;
/** Source names show in the Sources list; a pasted name is trimmed to this many characters. */
export const PASTED_SOURCE_NAME_MAX = 200;

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
  return tx();
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
    return orphans.length;
  });
  return tx();
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

function notInClause(ids: string[]): string {
  return ids.length > 0 ? ` AND source_id NOT IN (${ids.map(() => "?").join(", ")})` : "";
}

function retrieveFtsChunks(tenant: TenantContext, query: string, limit = 4, exclude: string[] = []): string[] {
  const q = knowledgeFtsQuery(query);
  if (!q) {
    return [];
  }
  try {
    const rows = sql
      .prepare(
        `SELECT body FROM knowledge_chunks WHERE workspace_id = ? AND knowledge_chunks MATCH ?${notInClause(exclude)} LIMIT ?`,
      )
      .all(workspaceId(tenant), q, ...exclude, limit) as Array<{ body: string }>;
    return rows.map((row) => row.body);
  } catch {
    return [];
  }
}

export async function retrieveChunks(
  tenant: TenantContext,
  query: string,
  limit = 4,
  options: RetrieveOptions = {},
): Promise<{ bodies: string[]; mode: "rag" | "fts" | "none" }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { bodies: [], mode: "none" };
  }
  const exclude = options.excludeSourceIds ?? [];
  const models = getKnowledgeModels(tenant);
  const vectorHits = await retrieveVectorChunks(tenant, trimmed, models, limit, exclude);
  if (vectorHits.length > 0) {
    return { bodies: vectorHits.map((hit) => hit.body), mode: "rag" };
  }
  const fts = retrieveFtsChunks(tenant, trimmed, limit, exclude);
  return { bodies: fts, mode: fts.length > 0 ? "fts" : "none" };
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

export async function knowledgeInjection(
  tenant: TenantContext,
  query = "",
  options: KnowledgeInjectionOptions = {},
): Promise<{ prompt: string; parts: { label: string; detail: string; tokens: number }[] }> {
  const soul = getSoul(tenant);
  const memories = listMemories(tenant).filter((item) => item.pinned);
  const retrieved = query
    ? await retrieveChunks(tenant, query, 4, { excludeSourceIds: excludedSourceIds(tenant, options) })
    : { bodies: [] as string[], mode: "none" as const };
  const soulBlock = [
    `Name: ${soul.name}`,
    `Role: ${soul.role}`,
    `Voice: ${soul.voice}`,
    soul.rules.length ? `Rules:\n- ${soul.rules.join("\n- ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  const memoryBlock = memories.map((item) => `- ${item.text}`).join("\n");
  const retrievedBlock = retrieved.bodies.map((chunk, index) => `[${index + 1}] ${chunk}`).join("\n\n");
  const sections = [
    soulBlock ? `## Soul\n${soulBlock}` : "",
    memoryBlock ? `## Pinned memories\n${memoryBlock}` : "",
    retrievedBlock ? `## Retrieved sources\n${retrievedBlock}` : "",
  ].filter(Boolean);
  const prompt = sections.length ? `\n\n# Workspace knowledge\n${sections.join("\n\n")}` : "";
  const est = (text: string) => Math.ceil(text.trim().length / 4);
  const sourcesDetail =
    retrieved.mode === "rag"
      ? `${retrieved.bodies.length} chunks · rag`
      : retrieved.mode === "fts"
        ? `${retrieved.bodies.length} chunks · fts`
        : `${retrieved.bodies.length} chunks`;
  return {
    prompt,
    parts: [
      { label: "Soul", detail: soul.name, tokens: est(soulBlock) },
      { label: "Memories", detail: `${memories.length} pinned`, tokens: est(memoryBlock) },
      { label: "Sources", detail: sourcesDetail, tokens: est(retrievedBlock) },
    ],
  };
}
