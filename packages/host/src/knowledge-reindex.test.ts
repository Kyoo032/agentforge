import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TenantContext } from "@agentforge/core";
import { buildGarbagePdf } from "@agentforge/core/pdf/test-fixtures";
import { createLocalWorkspace, db, deleteLocalWorkspace, sql } from "@agentforge/db";
import { STUB_EMBED_MODEL } from "./knowledge-embed";
import { reconstructSourceBody, reindexSource, reindexWorkspace } from "./knowledge-reindex";
import { chunkKnowledgeText } from "./knowledge-text";
import { addFileSource } from "./knowledge";
import { dispatch } from "./router";
import { getTenant } from "./tenant";

/**
 * Explicit re-index of one source (or a whole workspace): re-read the stored body, run the current
 * chunker, and replace the FTS rows *and* the vectors in one transaction.
 *
 * Sources indexed before the overlapping chunker keep their old boundaries until this runs, so the
 * two layouts it has to understand are the previous one (fixed 800-char slices, no overlap — the
 * join of its chunks is the exact body) and the current one (overlapping — the body is recovered
 * from the chunk overlap and must round-trip, which is what makes a second run a no-op in content).
 */

const ORG = "org-reindex";
const LEGACY_TEXT = Array.from(
  { length: 140 },
  (_, i) =>
    `Fact ${i + 1}: the migration memo records that the old chunk boundaries stayed put until the desk was explicitly re-indexed.`,
).join(" ");

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: ORG,
    workspaceId: `ws-reindex-${crypto.randomUUID()}`,
    userId: "user-reindex",
    role: "owner",
  };
}

function cleaned(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

/** The chunker the repo used before f28faa1: fixed, non-overlapping slices of the cleaned text. */
function oldSlices(text: string, size = 800): string[] {
  const body = cleaned(text);
  const out: string[] = [];
  for (let i = 0; i < body.length; i += size) {
    out.push(body.slice(i, i + size));
  }
  return out;
}

type SeedOptions = {
  id?: string;
  name?: string;
  type?: string;
  status?: string;
  createdAt?: number;
  chunkBodies?: string[];
  origin?: { kind: string; id: string } | null;
};

function seedSource(ctx: TenantContext, options: SeedOptions): string {
  const id = options.id ?? crypto.randomUUID();
  sql
    .prepare(
      `INSERT INTO knowledge_sources
         (id, workspace_id, name, type, status, chunks, error, created_at, origin_kind, origin_id)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
    )
    .run(
      id,
      ctx.workspaceId,
      options.name ?? "Seed source",
      options.type ?? "Paste",
      options.status ?? "Indexed",
      options.chunkBodies?.length ?? 0,
      options.createdAt ?? Date.now() - 60_000,
      options.origin?.kind ?? null,
      options.origin?.id ?? null,
    );
  writeChunks(ctx, id, options.chunkBodies ?? []);
  return id;
}

function writeChunks(ctx: TenantContext, id: string, bodies: readonly string[]): void {
  const insert = sql.prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)");
  for (const body of bodies) {
    insert.run(id, ctx.workspaceId, body);
  }
}

function writeStaleVectors(ctx: TenantContext, id: string, bodies: readonly string[]): void {
  const insert = sql.prepare(
    `INSERT INTO knowledge_vectors (id, workspace_id, source_id, chunk_index, body, embedding, model, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  bodies.forEach((body, index) => {
    insert.run(crypto.randomUUID(), ctx.workspaceId, id, index, body, JSON.stringify([0.25, 0.5]), STUB_EMBED_MODEL, Date.now() - 60_000);
  });
}

/** A source as the previous chunker left it: old-slice rows plus the vectors that match them. */
function seedLegacySource(ctx: TenantContext, options: Omit<SeedOptions, "chunkBodies"> & { text?: string } = {}): string {
  const bodies = oldSlices(options.text ?? LEGACY_TEXT);
  const id = seedSource(ctx, { ...options, chunkBodies: bodies });
  writeStaleVectors(ctx, id, bodies);
  return id;
}

function chunkBodies(ctx: TenantContext, id: string): string[] {
  const rows = sql
    .prepare("SELECT body FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ? ORDER BY rowid")
    .all(ctx.workspaceId, id) as Array<{ body: string }>;
  return rows.map((row) => row.body);
}

function vectorRows(ctx: TenantContext, id: string) {
  return sql
    .prepare(
      `SELECT chunk_index, body, model, created_at FROM knowledge_vectors
       WHERE workspace_id = ? AND source_id = ? ORDER BY chunk_index`,
    )
    .all(ctx.workspaceId, id) as Array<{ chunk_index: number; body: string; model: string; created_at: number }>;
}

function sourceRow(ctx: TenantContext, id: string) {
  return sql
    .prepare(
      `SELECT id, name, type, status, chunks, error, created_at, origin_kind, origin_id
       FROM knowledge_sources WHERE workspace_id = ? AND id = ?`,
    )
    .get(ctx.workspaceId, id) as
    | {
        id: string;
        name: string;
        type: string;
        status: string;
        chunks: number;
        error: string | null;
        created_at: number;
        origin_kind: string | null;
        origin_id: string | null;
      }
    | undefined;
}

describe("source body reconstruction", () => {
  it("recovers the exact body from the previous fixed-slice chunk layout", () => {
    const slices = oldSlices(LEGACY_TEXT);
    expect(slices.length).toBeGreaterThan(1);
    expect(reconstructSourceBody(slices)).toBe(cleaned(LEGACY_TEXT));
  });

  it("recovers a body from overlapping chunks the current chunker would re-produce", () => {
    const chunks = chunkKnowledgeText(LEGACY_TEXT);
    expect(chunks.length).toBeGreaterThan(1);
    const body = reconstructSourceBody(chunks);
    expect(reconstructSourceBody(chunkKnowledgeText(body))).toBe(body);
    expect(chunkKnowledgeText(body)).toEqual(chunks);
  });

  it("returns an empty body for no chunks", () => {
    expect(reconstructSourceBody([])).toBe("");
  });
});

describe("reindexSource", () => {
  let settingsDir: string;
  let mediaDir: string;
  const previous: Record<string, string | undefined> = {};
  const ENV_KEYS = ["AGENTFORGE_RUNTIME", "AGENTFORGE_SETTINGS_PATH", "MEDIA_ROOT"] as const;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previous[key] = process.env[key];
    }
    settingsDir = mkdtempSync(join(tmpdir(), "af-reindex-"));
    mediaDir = join(settingsDir, "media");
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
    process.env.MEDIA_ROOT = mediaDir;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("re-chunks a legacy paste source and rewrites its chunks and vectors together", async () => {
    const ctx = tenant();
    const id = seedLegacySource(ctx, { name: "Legacy memo" });
    const before = sourceRow(ctx, id);
    const expected = chunkKnowledgeText(LEGACY_TEXT);
    // The fixture really is on old boundaries: the new chunker would not produce these rows.
    expect(chunkBodies(ctx, id)).not.toEqual(expected);

    const outcome = await reindexSource(ctx, id);
    expect(outcome).toMatchObject({ status: "reindexed", sourceId: id, name: "Legacy memo", chunks: expected.length });

    expect(chunkBodies(ctx, id)).toEqual(expected);
    const vectors = vectorRows(ctx, id);
    expect(vectors.map((row) => row.body)).toEqual(expected);
    expect(vectors.map((row) => row.chunk_index)).toEqual(expected.map((_, index) => index));
    // Offline the embedder answers with local vectors, and they are stored under their own id.
    expect(vectors.every((row) => row.model === STUB_EMBED_MODEL)).toBe(true);

    const after = sourceRow(ctx, id);
    expect(after).toMatchObject({ status: "Indexed", chunks: expected.length, error: null });
    expect(after?.created_at).toBeGreaterThan(before?.created_at ?? 0);
    // One transaction stamped both: no window in which the FTS rows and their vectors disagree.
    expect(new Set(vectors.map((row) => row.created_at))).toEqual(new Set([after?.created_at]));
  });

  it("is idempotent: a second re-index leaves the same chunks and vectors", async () => {
    const ctx = tenant();
    const id = seedLegacySource(ctx);
    await reindexSource(ctx, id);
    const first = { chunks: chunkBodies(ctx, id), vectors: vectorRows(ctx, id).map((row) => row.body) };

    const again = await reindexSource(ctx, id);
    expect(again.status).toBe("reindexed");
    expect(chunkBodies(ctx, id)).toEqual(first.chunks);
    expect(vectorRows(ctx, id).map((row) => row.body)).toEqual(first.vectors);
    // No accumulation: one row per chunk in each table.
    expect(chunkBodies(ctx, id)).toHaveLength(first.chunks.length);
    expect(vectorRows(ctx, id)).toHaveLength(first.chunks.length);
  });

  it("re-indexes a File source from its stored upload, not from its old chunks", async () => {
    const ctx = tenant();
    const source = await addFileSource(ctx, {
      filename: "notes.txt",
      mime: "text/plain",
      bytes: new TextEncoder().encode("The first draft of the notes. ".repeat(60)),
    });
    expect(source.status).toBe("Indexed");

    // The row is legacy AND the stored upload changed under the same id: the re-index must read
    // the file, or it would keep the old copy alive forever.
    const replacement = "The rewritten notes say the archive was replaced in full. ".repeat(60);
    const storedPath = join(mediaDir, "knowledge", ORG, `${source.id}-notes.txt`);
    writeFileSync(storedPath, replacement);
    sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ctx.workspaceId, source.id);
    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ctx.workspaceId, source.id);
    const legacy = oldSlices("A completely different legacy body. ".repeat(60));
    writeChunks(ctx, source.id, legacy);
    writeStaleVectors(ctx, source.id, legacy);

    const outcome = await reindexSource(ctx, source.id);
    expect(outcome.status).toBe("reindexed");
    const expected = chunkKnowledgeText(replacement);
    expect(chunkBodies(ctx, source.id)).toEqual(expected);
    expect(vectorRows(ctx, source.id).map((row) => row.body)).toEqual(expected);
  });

  it("falls back to the stored chunks when the upload is gone", async () => {
    const ctx = tenant();
    const id = seedLegacySource(ctx, { name: "Orphaned upload", type: "File" });
    const outcome = await reindexSource(ctx, id);
    expect(outcome.status).toBe("reindexed");
    expect(chunkBodies(ctx, id)).toEqual(chunkKnowledgeText(LEGACY_TEXT));
  });

  it("records a Failed row when the stored upload no longer parses, and never throws", async () => {
    const ctx = tenant();
    const id = crypto.randomUUID();
    seedSource(ctx, { id, name: "broken.pdf", type: "File", chunkBodies: oldSlices(LEGACY_TEXT) });
    writeStaleVectors(ctx, id, oldSlices(LEGACY_TEXT));
    const dir = join(mediaDir, "knowledge", ORG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}-broken.pdf`), Buffer.from(buildGarbagePdf()));

    const outcome = await reindexSource(ctx, id);
    expect(outcome).toMatchObject({ status: "failed", sourceId: id });
    if (outcome.status === "failed") {
      expect(outcome.reason).toMatch(/^pdf_invalid/);
    }
    const row = sourceRow(ctx, id);
    expect(row).toMatchObject({ status: "Failed", chunks: 0 });
    expect(row?.error).toMatch(/^pdf_invalid/);
    expect(chunkBodies(ctx, id)).toEqual([]);
    expect(vectorRows(ctx, id)).toEqual([]);
  });

  it("records a Failed row, keeping the origin, when a source has no body left", async () => {
    const ctx = tenant();
    // A row whose chunk count claims text it no longer holds (hand-deleted rows, a damaged file).
    const id = seedSource(ctx, {
      name: "Chat card",
      type: "Chat",
      chunkBodies: [],
      origin: { kind: "thread", id: "thread-reindex" },
    });

    const outcome = await reindexSource(ctx, id);
    expect(outcome).toMatchObject({ status: "failed", reason: "No extractable text" });
    const row = sourceRow(ctx, id);
    expect(row).toMatchObject({ status: "Failed", chunks: 0 });
    // The origin is what keeps a later ingest from writing a duplicate card for the same thread.
    expect(row?.origin_kind).toBe("thread");
    expect(row?.origin_id).toBe("thread-reindex");
  });

  it("reports a missing source instead of throwing, and never touches another workspace", async () => {
    const ctx = tenant();
    const missing = crypto.randomUUID();
    await expect(reindexSource(ctx, missing)).resolves.toEqual({ status: "missing", sourceId: missing });

    const other = tenant();
    const otherId = seedLegacySource(other, { name: "Elsewhere" });
    await expect(reindexSource(ctx, otherId)).resolves.toEqual({ status: "missing", sourceId: otherId });
    expect(chunkBodies(other, otherId)).toEqual(oldSlices(LEGACY_TEXT));
  });

  it("keeps a corrupt embedding row out of the workspace when the write cannot happen", async () => {
    // A source deleted between the row read and the write: the rewrite must abort whole, leaving
    // no chunk or vector rows behind for a source that no longer exists.
    const ctx = tenant();
    const id = crypto.randomUUID();
    seedSource(ctx, { id, name: "Vanishing", chunkBodies: oldSlices(LEGACY_TEXT) });
    sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ? AND id = ?").run(ctx.workspaceId, id);

    const outcome = await reindexSource(ctx, id);
    expect(outcome).toEqual({ status: "missing", sourceId: id });
    expect(chunkBodies(ctx, id)).toEqual(oldSlices(LEGACY_TEXT));
    expect(vectorRows(ctx, id)).toEqual([]);
  });
});

describe("reindexWorkspace", () => {
  let settingsDir: string;
  let mediaDir: string;
  const previous: Record<string, string | undefined> = {};
  const ENV_KEYS = ["AGENTFORGE_RUNTIME", "AGENTFORGE_SETTINGS_PATH", "MEDIA_ROOT"] as const;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previous[key] = process.env[key];
    }
    settingsDir = mkdtempSync(join(tmpdir(), "af-reindex-ws-"));
    mediaDir = join(settingsDir, "media");
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
    process.env.MEDIA_ROOT = mediaDir;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("re-indexes every indexed source of one workspace and keeps going past a failure", async () => {
    const ctx = tenant();
    const legacyId = seedLegacySource(ctx, { name: "Legacy" });
    const currentText = "An already-current source whose chunks are stable. ".repeat(80);
    const currentId = seedSource(ctx, { name: "Current", chunkBodies: chunkKnowledgeText(currentText) });
    const brokenId = crypto.randomUUID();
    seedSource(ctx, { id: brokenId, name: "broken.pdf", type: "File", chunkBodies: oldSlices(LEGACY_TEXT) });
    const dir = join(mediaDir, "knowledge", ORG);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${brokenId}-broken.pdf`), Buffer.from(buildGarbagePdf()));
    const failedRow = seedSource(ctx, { name: "Old failure", status: "Failed" });

    const other = tenant();
    const otherId = seedLegacySource(other, { name: "Other desk" });

    const summary = await reindexWorkspace(ctx);
    expect(summary).toMatchObject({ total: 3, reindexed: 2, failed: 1, missing: 0 });
    expect(summary.results.map((result) => result.sourceId).sort()).toEqual([legacyId, currentId, brokenId].sort());

    expect(chunkBodies(ctx, legacyId)).toEqual(chunkKnowledgeText(LEGACY_TEXT));
    expect(chunkBodies(ctx, currentId)).toEqual(chunkKnowledgeText(currentText));
    expect(sourceRow(ctx, brokenId)?.status).toBe("Failed");
    // A row that was already Failed is not a re-index candidate: it has no boundaries to rewrite.
    expect(sourceRow(ctx, failedRow)?.status).toBe("Failed");
    // Another workspace's rows are never swept.
    expect(chunkBodies(other, otherId)).toEqual(oldSlices(LEGACY_TEXT));
  });

  it("answers an empty workspace with zeroes", async () => {
    await expect(reindexWorkspace(tenant())).resolves.toEqual({
      total: 0,
      reindexed: 0,
      failed: 0,
      missing: 0,
      results: [],
    });
  });
});

describe("re-index routes", () => {
  let settingsDir: string;
  let mediaDir: string;
  const previous: Record<string, string | undefined> = {};
  const ENV_KEYS = ["AGENTFORGE_RUNTIME", "AGENTFORGE_SETTINGS_PATH", "MEDIA_ROOT"] as const;

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previous[key] = process.env[key];
    }
    settingsDir = mkdtempSync(join(tmpdir(), "af-reindex-routes-"));
    mediaDir = join(settingsDir, "media");
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
    process.env.MEDIA_ROOT = mediaDir;
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previous[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(settingsDir, { recursive: true, force: true });
  });

  function call(method: string, path: string, workspaceId?: string, body?: unknown) {
    return dispatch({ method, path, query: {}, params: {}, headers: {}, body, workspaceId });
  }

  it("serves one source and the whole desk, and 404s an unknown source", async () => {
    const owner = await getTenant();
    const workspace = await createLocalWorkspace(db, owner.organizationId, `reindex-route-${crypto.randomUUID().slice(0, 8)}`);
    try {
      const ctx: TenantContext = { ...owner, workspaceId: workspace.id };
      const id = seedLegacySource(ctx, { name: "Route paste", type: "Paste" });

      const one = await call("POST", `/api/v1/knowledge/sources/${id}/reindex`, workspace.id);
      expect(one.type).toBe("json");
      if (one.type !== "json") {
        return;
      }
      expect(one.status).toBe(200);
      expect(one.body).toMatchObject({ status: "reindexed", sourceId: id });
      expect(chunkBodies(ctx, id)).toEqual(chunkKnowledgeText(LEGACY_TEXT));

      const all = await call("POST", "/api/v1/knowledge/reindex", workspace.id);
      expect(all.type).toBe("json");
      if (all.type !== "json") {
        return;
      }
      expect(all.status).toBe(200);
      expect(all.body).toMatchObject({ total: 1, reindexed: 1, failed: 0, missing: 0 });

      const absent = await call("POST", `/api/v1/knowledge/sources/${crypto.randomUUID()}/reindex`, workspace.id);
      expect(absent.type).toBe("json");
      if (absent.type === "json") {
        expect(absent.status).toBe(404);
        expect(absent.body).toMatchObject({ error: { code: "not_found" } });
      }
    } finally {
      await deleteLocalWorkspace(db, owner.organizationId, workspace.id);
    }
  }, 30_000);
});
