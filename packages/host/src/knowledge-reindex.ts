import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { ApiError, type TenantContext } from "@agentforge/core";
import { sql } from "@agentforge/db";
import { extractText } from "./knowledge-extract";
import { getKnowledgeModels, markSourceFailed, nextCreatedAt, type SourceOriginKind } from "./knowledge";
import { embedTextsWithModel } from "./knowledge-embed";
import { CHUNK_OVERLAP, chunkKnowledgeText, ftsSourceFilter } from "./knowledge-text";
import { tenantMediaRoot } from "./media-root";
import { log } from "./log";

/**
 * Explicit re-index for the built-in engine: re-read one source's body, run the current chunker,
 * and replace its FTS rows *and* its vectors in one transaction.
 *
 * Why this exists: the overlapping chunker landed after sources were already indexed, and a source
 * whose chunk rows predate it keeps its old boundaries forever — the map projection is not allowed
 * to rewrite chunk rows, and nothing else touches them. This is the deliberate rewrite (per source,
 * or a whole workspace sweep), which is also what an embedding-model change needs.
 *
 * The body is re-read, never guessed from the chunks casually:
 * - `File` sources still have their original upload under `media/knowledge/<org>/<id>-<name>`, so
 *   the text is extracted again — the exact bytes, not a reconstruction. A stored upload that no
 *   longer parses records a `Failed` row (with its reason) instead of throwing; an upload that is
 *   gone or whose name no longer names a supported format falls through to the chunk rows, which
 *   are the body of record for every other source type.
 * - Every other source type (paste, URL, work cards) keeps its text **only** in `knowledge_chunks`,
 *   so the body is recovered from those rows. Two layouts are understood: the current overlapping
 *   one (the shared prefix between consecutive chunks is `min(overlap, |chunk| - 1)` characters, so
 *   the merge is the chunker's exact inverse) and the previous fixed-slice one (chunks were plain
 *   non-overlapping slices, so their join is the exact body). The current layout self-checks — the
 *   merge must round-trip through the chunker — which is also what makes a second re-index stable:
 *   a current source re-chunks to the same rows it already has, and the write is content-identical.
 *
 * A `Failed` row is always the outcome of a body that cannot be produced; nothing here throws at
 * the caller. The write is one `tx.immediate()` over `knowledge_sources`, `knowledge_chunks` and
 * `knowledge_vectors`, so retrieval can never observe new boundaries against old vectors.
 */

export type ReindexOutcome =
  | { status: "reindexed"; sourceId: string; name: string; type: string; chunks: number }
  | { status: "failed"; sourceId: string; name: string; type: string; reason: string }
  | { status: "missing"; sourceId: string };

export type WorkspaceReindex = {
  /** `Indexed` sources of the workspace this call swept. */
  total: number;
  reindexed: number;
  failed: number;
  missing: number;
  results: ReindexOutcome[];
};

/** Same wording the index path uses, so a Failed row reads the same whichever path wrote it. */
const NO_TEXT = "No extractable text";

type ReindexRow = {
  id: string;
  name: string;
  type: string;
  status: string;
  origin_kind: string | null;
  origin_id: string | null;
};

/** The row vanished between the read and the write: abort the transaction, create nothing. */
class MissingSourceError extends Error {
  constructor() {
    super("source no longer exists");
    this.name = "MissingSourceError";
  }
}

function short(error: unknown): string {
  return error instanceof Error && error.message ? error.message.slice(0, 160) : "error";
}

function warn(what: string, error: unknown): void {
  log.warn("knowledge_reindex_step_failed", { step: what, detail: short(error) });
}

function sourceRow(tenant: TenantContext, sourceId: string): ReindexRow | null {
  try {
    const row = sql
      .prepare(
        `SELECT id, name, type, status, origin_kind, origin_id
         FROM knowledge_sources WHERE workspace_id = ? AND id = ?`,
      )
      .get(tenant.workspaceId, sourceId) as ReindexRow | undefined;
    return row ?? null;
  } catch (error) {
    warn(`${sourceId} could not be read`, error);
    return null;
  }
}

/**
 * The chunks an old (or any chunk-backed) source still holds, in insert order — read through the
 * FTS index with a `source_id` column filter, never an unqualified select (same rule as
 * `indexableSource`: an unqualified read has no MATCH to plan against and scans the workspace).
 */
function storedChunks(tenant: TenantContext, sourceId: string): string[] {
  const match = ftsSourceFilter(sourceId);
  try {
    const rows = sql
      .prepare(`SELECT body FROM knowledge_chunks WHERE knowledge_chunks MATCH ? AND workspace_id = ? ORDER BY rowid`)
      .all(match, tenant.workspaceId) as Array<{ body: string }>;
    return rows.map((row) => row.body);
  } catch (error) {
    warn(`${sourceId} chunk rows could not be read`, error);
    return [];
  }
}

/**
 * The exact inverse of the current chunker for consecutive chunks: the next chunk restarts at
 * `max(previous split - overlap, own start + 1)`, so the shared prefix is `min(overlap, |prev| - 1)`
 * — a short chunk shares all but its first character.
 */
function mergeOverlap(chunks: readonly string[], overlap = CHUNK_OVERLAP): string {
  let body = chunks[0] ?? "";
  for (let i = 1; i < chunks.length; i += 1) {
    const prev = chunks[i - 1] ?? "";
    const shared = Math.min(overlap, Math.max(0, prev.length - 1));
    body += (chunks[i] ?? "").slice(shared);
  }
  return body;
}

/**
 * Recover the body a source's chunks were cut from.
 *
 * The overlap merge is attempted first and trusted only when the chunker re-produces the exact
 * chunk list from it (the current layout). Otherwise the chunks are the previous fixed-slice
 * layout, whose join is the exact body — it is the reason this feature exists, so no round-trip is
 * demanded of it. A layout older than both is not recoverable; the join is the least-lossy guess,
 * and the next sweep sees the new layout.
 */
export function reconstructSourceBody(chunks: readonly string[]): string {
  const merged = mergeOverlap(chunks);
  const recounted = chunkKnowledgeText(merged);
  const roundTrips = recounted.length === chunks.length && recounted.every((body, index) => body === chunks[index]);
  return roundTrips ? merged : chunks.join("");
}

/** The stored upload for a source, if the desk still has one. Naming matches `addFileSource`. */
async function findStoredUpload(tenant: TenantContext, sourceId: string): Promise<string | null> {
  try {
    const dir = path.join(tenantMediaRoot(tenant.tenantId), "knowledge", tenant.organizationId);
    const entries = await readdir(dir);
    const name = entries.find((entry) => entry.startsWith(`${sourceId}-`));
    return name ? path.join(dir, name) : null;
  } catch {
    // No upload directory / source dir: nothing was stored for this source (or it was cleaned up).
    return null;
  }
}

function isFormatFailure(error: unknown): error is ApiError {
  return error instanceof ApiError && /^(pdf|docx)_/.test(error.code);
}

/**
 * Re-extract text from a File source's stored upload. A parse failure of a recognized format
 * (`pdf_*` / `docx_*`) is reported so the caller can record it; a missing / unsupported / unreadable
 * upload is not a failure — the chunk rows still hold the body.
 */
async function uploadText(
  tenant: TenantContext,
  sourceId: string,
): Promise<{ text: string | null; failure: string | null }> {
  const stored = await findStoredUpload(tenant, sourceId);
  if (!stored) {
    return { text: null, failure: null };
  }
  let bytes: Buffer;
  try {
    bytes = await readFile(stored);
  } catch (error) {
    warn(`${sourceId} upload could not be read`, error);
    return { text: null, failure: null };
  }
  try {
    // The mangled stored name keeps the original extension, and `extractText` keys its formats off
    // the extension: the mime the browser sent is not persisted anywhere, so nothing else is left.
    return { text: await extractText(path.basename(stored), "", bytes), failure: null };
  } catch (error) {
    if (isFormatFailure(error)) {
      return { text: null, failure: `${error.code}: ${error.message}` };
    }
    warn(`${sourceId} upload is not a supported format`, error);
    return { text: null, failure: null };
  }
}

/**
 * Replace the source's rows: chunks, vectors, and the row's own count/status/version stamp, in one
 * immediate transaction. The embedding is computed before the transaction opens (it may be a
 * network call); everything after that either lands whole or not at all.
 */
async function replaceSourceRows(tenant: TenantContext, sourceId: string, chunks: string[]): Promise<void> {
  const models = getKnowledgeModels(tenant);
  const { vectors, model: storedModel } = await embedTextsWithModel(chunks, models.embeddingModel, tenant);
  const createdAt = nextCreatedAt();
  const ws = tenant.workspaceId;
  const insertChunk = sql.prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)");
  const insertVector = sql.prepare(
    `INSERT INTO knowledge_vectors (id, workspace_id, source_id, chunk_index, body, embedding, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = sql.transaction(() => {
    const updated = sql
      .prepare(
        `UPDATE knowledge_sources SET status = 'Indexed', chunks = ?, error = NULL, created_at = ?
         WHERE workspace_id = ? AND id = ?`,
      )
      .run(chunks.length, createdAt, ws, sourceId).changes;
    if (updated === 0) {
      // Deleted while this call was embedding: writing the rows now would orphan them (the vector
      // search serves rows by source id and a missing row's chunks would still match FTS queries).
      throw new MissingSourceError();
    }
    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ws, sourceId);
    sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ws, sourceId);
    for (let i = 0; i < chunks.length; i += 1) {
      insertChunk.run(sourceId, ws, chunks[i]);
      insertVector.run(
        crypto.randomUUID(),
        ws,
        sourceId,
        i,
        chunks[i],
        JSON.stringify(vectors[i] ?? []),
        storedModel,
        createdAt,
      );
    }
  });
  // Reads then writes, so the write lock is taken up front: a deferred upgrade fails instantly
  // under a second writer (the same rule every other knowledge transaction follows).
  tx.immediate();
}

/** Record the reason on a `Failed` row, keeping name / type / origin. Never throws. */
function recordFailure(tenant: TenantContext, row: ReindexRow, reason: string): ReindexOutcome {
  try {
    markSourceFailed(
      tenant,
      {
        id: row.id,
        name: row.name,
        type: row.type,
        origin:
          row.origin_kind && row.origin_id ? { kind: row.origin_kind as SourceOriginKind, id: row.origin_id } : null,
      },
      reason,
    );
  } catch (error) {
    warn(`${row.id} failure not recorded`, error);
  }
  return { status: "failed", sourceId: row.id, name: row.name, type: row.type, reason };
}

/**
 * Re-index one source. Idempotent: run it twice and the second run rewrites the same chunks and
 * vectors it wrote the first time (content-identical; the row's version stamp moves, which is what
 * invalidates any embed that was in flight). Never throws; `missing` covers a source that is not
 * this workspace's — or that was deleted while the call was in flight.
 */
export async function reindexSource(tenant: TenantContext, sourceId: string): Promise<ReindexOutcome> {
  const row = sourceRow(tenant, sourceId);
  if (!row) {
    return { status: "missing", sourceId };
  }

  let body: string | null = null;
  if (row.type === "File") {
    const upload = await uploadText(tenant, sourceId);
    if (upload.failure) {
      return recordFailure(tenant, row, upload.failure);
    }
    body = upload.text;
  }
  body ??= reconstructSourceBody(storedChunks(tenant, sourceId));

  const chunks = chunkKnowledgeText(body);
  if (chunks.length === 0) {
    return recordFailure(tenant, row, NO_TEXT);
  }

  try {
    await replaceSourceRows(tenant, sourceId, chunks);
  } catch (error) {
    if (error instanceof MissingSourceError) {
      return { status: "missing", sourceId };
    }
    // The transaction rolled back whole: the previous rows are still the source's state.
    warn(`${sourceId} not rewritten`, error);
    return { status: "failed", sourceId, name: row.name, type: row.type, reason: short(error) };
  }
  return { status: "reindexed", sourceId, name: row.name, type: row.type, chunks: chunks.length };
}

/**
 * Re-index every `Indexed` source of one workspace, oldest first. Rows already `Failed` are skipped
 * — they hold no boundaries to rewrite — and one source failing never stops the sweep.
 */
export async function reindexWorkspace(tenant: TenantContext): Promise<WorkspaceReindex> {
  let ids: string[] = [];
  try {
    const rows = sql
      .prepare(
        `SELECT id FROM knowledge_sources WHERE workspace_id = ? AND status = 'Indexed'
         ORDER BY created_at ASC, id ASC`,
      )
      .all(tenant.workspaceId) as Array<{ id: string }>;
    ids = rows.map((row) => row.id);
  } catch (error) {
    warn("workspace sweep could not list sources", error);
  }
  const results: ReindexOutcome[] = [];
  for (const id of ids) {
    results.push(await reindexSource(tenant, id));
  }
  const count = (status: ReindexOutcome["status"]) => results.filter((result) => result.status === status).length;
  return {
    total: results.length,
    reindexed: count("reindexed"),
    failed: count("failed"),
    missing: count("missing"),
    results,
  };
}
