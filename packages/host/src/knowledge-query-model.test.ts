import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stubEmbed, type TenantContext } from "@agentforge/core";
import { sql } from "@agentforge/db";
import { STUB_EMBED_MODEL, embedQuery, indexSourceVectors, retrieveVectorChunks } from "./knowledge-embed";
import { putKnowledgeModels, retrieveChunks } from "./knowledge";

/**
 * A query vector and the rows it is compared against must come from the same embedding model.
 *
 * Offline (or with the embed circuit open) the query falls back to the 32-dim local `stub-fnv-32`
 * vector. `cosineSimilarity` truncates to the shorter side, so comparing that stub against a
 * 1536-dim row compares 32 of 1536 dimensions — noise that clears the cosine floor and fabricates
 * a semantic hit. Vector search must therefore search the rows of the model the query was actually
 * embedded with, and answer with nothing when that model has no rows.
 */

const REAL_MODEL = "text-embedding-3-small";
const REAL_DIMS = 1536;

function tenant(): TenantContext {
  return {
    organizationId: "org-query-model",
    workspaceId: `ws-query-model-${crypto.randomUUID()}`,
    userId: "user-query-model",
    role: "owner",
  };
}

function models(embeddingModel: string) {
  return { embeddingModel, brainModel: "gpt-5.6-luna", verifierModel: "deepseek-v4-flash" };
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

/**
 * A row of the real model's width whose first 32 dimensions are exactly the stub vector of its body
 * — the worst case for a truncating cosine, and the one that used to score as a confident hit.
 */
function wideVector(body: string): number[] {
  return [...stubEmbed(body), ...new Array(REAL_DIMS - 32).fill(0)];
}

function seedRealVector(ctx: TenantContext, sourceId: string, chunkIndex: number, body: string): void {
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
      JSON.stringify(wideVector(body)),
      REAL_MODEL,
      Date.now(),
    );
}

describe("query vector model", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-query-model-"));
    // Stub runtime is the in-process stand-in for "no key / circuit open": every embed is local.
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("says which model the query was embedded with, not which was asked for", async () => {
    const embedded = await embedQuery("vendor concentration", REAL_MODEL);
    expect(embedded.model).toBe(STUB_EMBED_MODEL);
    expect(embedded.vector).toEqual(stubEmbed("vendor concentration"));
    expect(embedded.vector).toHaveLength(32);
  });

  it("never scores a stub query against real-model rows", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const body = "vendor concentration risk in the spend table";
    seedSource(ctx, sourceId, "Spend table");
    seedChunk(ctx, sourceId, body);
    seedRealVector(ctx, sourceId, 0, body);
    putKnowledgeModels(ctx, models(REAL_MODEL));

    const hits = await retrieveVectorChunks(ctx, "vendor concentration", models(REAL_MODEL), 4);
    expect(hits).toEqual([]);
  });

  it("falls back to keyword-only retrieval when only the wrong model has rows", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const body = "vendor concentration risk in the spend table";
    seedSource(ctx, sourceId, "Spend table");
    seedChunk(ctx, sourceId, body);
    seedRealVector(ctx, sourceId, 0, body);
    putKnowledgeModels(ctx, models(REAL_MODEL));

    const result = await retrieveChunks(ctx, "vendor concentration", 4);
    expect(result.mode).toBe("fts");
    expect(result.vectorModel).toBe(null);
    expect(result.chunks.map((chunk) => chunk.sourceId)).toEqual([sourceId]);
  });

  it("still serves the local stub rows the same query was embedded against", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const body = "vendor concentration risk in the spend table";
    seedSource(ctx, sourceId, "Spend table");
    seedChunk(ctx, sourceId, body);
    putKnowledgeModels(ctx, models(REAL_MODEL));
    await indexSourceVectors(ctx, sourceId, [body], REAL_MODEL);

    const hits = await retrieveVectorChunks(ctx, "vendor concentration", models(REAL_MODEL), 4);
    expect(hits.length).toBeGreaterThan(0);

    const result = await retrieveChunks(ctx, "vendor concentration", 4);
    expect(result.mode).toBe("hybrid");
    expect(result.vectorModel).toBe(STUB_EMBED_MODEL);
  });

  it("prefers the real rows when the query itself was embedded by the real model", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const body = "vendor concentration risk in the spend table";
    seedSource(ctx, sourceId, "Spend table");
    seedChunk(ctx, sourceId, body);
    seedRealVector(ctx, sourceId, 0, body);
    putKnowledgeModels(ctx, models(REAL_MODEL));

    // `stub-fnv-32` *is* a real model id from the query path's point of view: asking for it embeds
    // with it, so its own rows are the ones that may be searched — never the 1536-dim ones.
    const stubHits = await retrieveVectorChunks(ctx, "vendor concentration", models(STUB_EMBED_MODEL), 4);
    expect(stubHits).toEqual([]);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
