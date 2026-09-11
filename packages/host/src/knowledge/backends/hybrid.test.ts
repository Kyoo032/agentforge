import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import { stubEmbed, type TenantContext } from "@agentforge/core";
import { addPastedSource, retrieveChunks } from "../../knowledge";
import { STUB_EMBED_MODEL } from "../../knowledge-embed";
import { RRF_K, fuseRrf } from "./builtin";

/**
 * Hybrid retrieval: bm25 and cosine are two opinions, and Reciprocal Rank Fusion is how they are
 * added up. The point of these tests is that a hit only one engine can see still reaches the prompt.
 */

function tenant(): TenantContext {
  return {
    organizationId: "org-hybrid",
    workspaceId: `ws-hybrid-${crypto.randomUUID()}`,
    userId: "user-hybrid",
    role: "owner",
  };
}

function plantedToken(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/** Strips a source from the FTS table, leaving only its vectors: a vector-only hit. */
function dropChunks(ctx: TenantContext, sourceId: string): void {
  sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?").run(ctx.workspaceId, sourceId);
}

/** Strips a source's vectors, leaving only its FTS rows: an FTS-only hit. */
function dropVectors(ctx: TenantContext, sourceId: string): void {
  sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?").run(ctx.workspaceId, sourceId);
}

function seedSource(ctx: TenantContext, id: string, name: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, ?, 'Paste', 'Indexed', 1, NULL, ?)`,
    )
    .run(id, ctx.workspaceId, name, Date.now());
}

function seedChunk(ctx: TenantContext, sourceId: string, body: string): void {
  sql
    .prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)")
    .run(sourceId, ctx.workspaceId, body);
}

function seedStubVector(ctx: TenantContext, sourceId: string, chunkIndex: number, body: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_vectors (id, workspace_id, source_id, chunk_index, body, embedding, model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      ctx.workspaceId,
      sourceId,
      chunkIndex,
      body,
      JSON.stringify(stubEmbed(body)),
      STUB_EMBED_MODEL,
      Date.now(),
    );
}

describe("hybrid retrieval", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-hybrid-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("surfaces an FTS-only hit and a vector-only hit in the same query", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const ftsOnly = await addPastedSource(ctx, "Fts only", `The code name is ${token} in the keyword lane.`);
    const vectorOnly = await addPastedSource(ctx, "Vector only", `The code name is ${token} in the vector lane.`);
    dropVectors(ctx, ftsOnly.id);
    dropChunks(ctx, vectorOnly.id);

    const result = await retrieveChunks(ctx, token, 4);
    expect(result.mode).toBe("hybrid");
    const names = result.chunks.map((chunk) => chunk.sourceName).sort();
    expect(names).toEqual(["Fts only", "Vector only"]);
    for (const chunk of result.chunks) {
      expect(chunk.score).toBeGreaterThan(0);
      expect(chunk.score).toBeLessThanOrEqual(1);
    }
  });

  it("orders identically on a repeated query", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const ftsOnly = await addPastedSource(ctx, "Fts only", `The code name is ${token} in the keyword lane.`);
    const vectorOnly = await addPastedSource(ctx, "Vector only", `The code name is ${token} in the vector lane.`);
    dropVectors(ctx, ftsOnly.id);
    dropChunks(ctx, vectorOnly.id);

    const first = await retrieveChunks(ctx, token, 4);
    const second = await retrieveChunks(ctx, token, 4);
    expect(second.chunks).toEqual(first.chunks);
  });

  it("scores a chunk ranked first by both engines at exactly 1", async () => {
    const ctx = tenant();
    const token = plantedToken();
    await addPastedSource(ctx, "Both lanes", `The code name is ${token}.`);

    const result = await retrieveChunks(ctx, token, 4);
    expect(result.mode).toBe("hybrid");
    expect(result.chunks[0]?.score).toBeCloseTo(1, 10);
  });

  it("fuses by (sourceId, chunkIndex) with k = 60 and normalizes into (0, 1]", () => {
    const chunk = (sourceId: string, chunkIndex: number) => ({
      body: `${sourceId}-${chunkIndex}`,
      sourceId,
      sourceName: sourceId,
      score: 0,
      chunkIndex,
    });
    expect(RRF_K).toBe(60);
    const fused = fuseRrf([[chunk("a", 0), chunk("b", 1)], [chunk("b", 1), chunk("c", 0)]], 10);
    expect(fused.map((item) => item.sourceId)).toEqual(["b", "a", "c"]);
    // b: 1/62 + 1/61 over a 2/61 ceiling; a and c are rank 1 and rank 2 of one list each.
    expect(fused[0]?.score).toBeCloseTo((1 / 62 + 1 / 61) / (2 / 61), 10);
    expect(fused[1]?.score).toBeCloseTo(1 / 61 / (2 / 61), 10);
    for (const item of fused) {
      expect(item.score).toBeGreaterThan(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  it("collapses a key repeated inside one list instead of double-counting it", () => {
    const chunk = (sourceId: string, chunkIndex: number, body: string) => ({
      body,
      sourceId,
      sourceName: sourceId,
      score: 0,
      chunkIndex,
    });
    // One engine listing the same (source, chunkIndex) twice is a fact of life — two identical chunk
    // bodies in one source share a fuse key. Summing both contributions put the score over the
    // ceiling (1/61 + 1/62 against a 1/61 ceiling ≈ 1.98) and swallowed a slot in the result.
    const fused = fuseRrf([[chunk("a", 0, "same"), chunk("a", 0, "same"), chunk("b", 0, "other")]], 10);
    expect(fused).toHaveLength(2);
    expect(fused[0]?.sourceId).toBe("a");
    // Best rank wins: "a" is rank 1 of its list, so it scores exactly the ceiling and no more.
    expect(fused[0]?.score).toBeCloseTo(1, 10);
    for (const item of fused) {
      expect(item.score).toBeGreaterThan(0);
      expect(item.score).toBeLessThanOrEqual(1);
    }
  });

  it("keeps two identical chunk bodies of one source apart", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const sourceId = crypto.randomUUID();
    const body = `The code name is ${token} in both copies.`;
    seedSource(ctx, sourceId, "Duplicated");
    seedChunk(ctx, sourceId, body);
    seedChunk(ctx, sourceId, body);
    seedStubVector(ctx, sourceId, 0, body);
    seedStubVector(ctx, sourceId, 1, body);

    const result = await retrieveChunks(ctx, token, 4);
    const indexes = result.chunks.map((chunk) => chunk.chunkIndex).sort();
    expect(indexes).toEqual([0, 1]);
    for (const chunk of result.chunks) {
      expect(chunk.score).toBeGreaterThan(0);
      expect(chunk.score).toBeLessThanOrEqual(1);
    }
  });

  it("gives distinct chunk indexes to FTS rows whose fallback ranking cannot see them", async () => {
    const ctx = tenant();
    const token = plantedToken();
    // A source id the FTS column filter cannot express (it tokenizes to nothing) is how the rank
    // fallback ends up empty in the wild — a re-index in flight does the same thing. Every row then
    // fell back to chunk index 0, so two distinct chunks fused into one over-scored entry.
    const sourceId = "...";
    // Source ids are unique database-wide, and this one is fixed by construction: clear the row a
    // previous run of this test left behind before planting it again.
    sql.prepare("DELETE FROM knowledge_sources WHERE id = ?").run(sourceId);
    seedSource(ctx, sourceId, "No vectors");
    seedChunk(ctx, sourceId, `The code name is ${token} in the first chunk.`);
    seedChunk(ctx, sourceId, `The code name is ${token} in the second chunk.`);

    const result = await retrieveChunks(ctx, token, 4);
    expect(result.mode).toBe("fts");
    expect(result.chunks).toHaveLength(2);
    expect(new Set(result.chunks.map((chunk) => chunk.chunkIndex)).size).toBe(2);
    for (const chunk of result.chunks) {
      expect(chunk.score).toBeLessThanOrEqual(1);
    }
  });

  it("breaks ties by source id then chunk index, so the order never wobbles", () => {
    const chunk = (sourceId: string, chunkIndex: number) => ({
      body: "x",
      sourceId,
      sourceName: sourceId,
      score: 0,
      chunkIndex,
    });
    const fused = fuseRrf([[chunk("b", 1), chunk("b", 0), chunk("a", 0)]], 10);
    const rerun = fuseRrf([[chunk("b", 1), chunk("b", 0), chunk("a", 0)]], 10);
    expect(fused.map((item) => `${item.sourceId}#${item.chunkIndex}`)).toEqual(rerun.map((item) => `${item.sourceId}#${item.chunkIndex}`));
    expect(fused[0]?.chunkIndex).toBe(1);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
