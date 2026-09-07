import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "@agentforge/db";
import {
  ApiError,
  assertAllowedEndpointUrl,
  htmlToText,
  isHtmlContent,
  plainToText,
  type KnowledgeModels,
  type TenantContext,
} from "@agentforge/core";
import { mediaRoot } from "./media-root";
import { fetchPublicHttps } from "./safe-fetch";
import { chunkKnowledgeText, knowledgeFtsQuery } from "./knowledge-text";
import { deleteVectorsForSource, indexSourceVectors, retrieveVectorChunks } from "./knowledge-embed";
import { modeCatalogPayload } from "./selectable-models";

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

export type KnowledgeSource = {
  id: string;
  name: string;
  type: string;
  status: "Indexed" | "Indexing" | "Failed";
  chunks: number;
  error?: string | null;
  createdAt: number;
};

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
    .prepare(
      "SELECT id, name, type, status, chunks, error, created_at FROM knowledge_sources WHERE workspace_id = ? ORDER BY created_at DESC",
    )
    .all(workspaceId(tenant)) as Array<{
    id: string;
    name: string;
    type: string;
    status: KnowledgeSource["status"];
    chunks: number;
    error: string | null;
    created_at: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    chunks: row.chunks,
    error: row.error,
    createdAt: row.created_at,
  }));
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

async function indexSource(
  tenant: TenantContext,
  id: string,
  name: string,
  type: string,
  text: string,
): Promise<KnowledgeSource> {
  const chunks = chunkKnowledgeText(text);
  const createdAt = Date.now();
  if (chunks.length === 0) {
    sql
      .prepare(
        "INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
      )
      .run(id, workspaceId(tenant), name, type, "Failed", "No extractable text", createdAt);
    return { id, name, type, status: "Failed", chunks: 0, error: "No extractable text", createdAt };
  }
  const insertChunk = sql.prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)");
  const tx = sql.transaction(() => {
    sql
      .prepare(
        "INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)",
      )
      .run(id, workspaceId(tenant), name, type, "Indexed", chunks.length, createdAt);
    for (const chunk of chunks) {
      insertChunk.run(id, workspaceId(tenant), chunk);
    }
  });
  tx();
  const models = getKnowledgeModels(tenant);
  await indexSourceVectors(tenant, id, chunks, models.embeddingModel);
  return { id, name, type, status: "Indexed", chunks: chunks.length, createdAt };
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
export const PASTED_SOURCE_TYPES = ["Paste", "Dossier", "Analysis", "Brief"] as const;
export type PastedSourceType = (typeof PASTED_SOURCE_TYPES)[number];
export const PASTED_SOURCE_MAX_CHARS = 2_000_000;

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
  return indexSource(tenant, crypto.randomUUID(), name.trim() || "Pasted notes", type, text);
}

export function deleteSource(tenant: TenantContext, id: string): void {
  deleteVectorsForSource(tenant, id);
  sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(workspaceId(tenant), id);
  sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(workspaceId(tenant), id);
}

function retrieveFtsChunks(tenant: TenantContext, query: string, limit = 4): string[] {
  const q = knowledgeFtsQuery(query);
  if (!q) {
    return [];
  }
  try {
    const rows = sql
      .prepare(`SELECT body FROM knowledge_chunks WHERE workspace_id = ? AND knowledge_chunks MATCH ? LIMIT ?`)
      .all(workspaceId(tenant), q, limit) as Array<{ body: string }>;
    return rows.map((row) => row.body);
  } catch {
    return [];
  }
}

export async function retrieveChunks(
  tenant: TenantContext,
  query: string,
  limit = 4,
): Promise<{ bodies: string[]; mode: "rag" | "fts" | "none" }> {
  const trimmed = query.trim();
  if (!trimmed) {
    return { bodies: [], mode: "none" };
  }
  const models = getKnowledgeModels(tenant);
  const vectorHits = await retrieveVectorChunks(tenant, trimmed, models, limit);
  if (vectorHits.length > 0) {
    return { bodies: vectorHits.map((hit) => hit.body), mode: "rag" };
  }
  const fts = retrieveFtsChunks(tenant, trimmed, limit);
  return { bodies: fts, mode: fts.length > 0 ? "fts" : "none" };
}

export async function knowledgeInjection(
  tenant: TenantContext,
  query = "",
): Promise<{ prompt: string; parts: { label: string; detail: string; tokens: number }[] }> {
  const soul = getSoul(tenant);
  const memories = listMemories(tenant).filter((item) => item.pinned);
  const retrieved = query ? await retrieveChunks(tenant, query) : { bodies: [] as string[], mode: "none" as const };
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
