import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, stubEmbed, type TenantContext } from "@agentforge/core";
import { sql } from "@agentforge/db";
import {
  STUB_EMBED_MODEL,
  countVectorsForModel,
  indexSourceVectors,
  resolveVectorModel,
  retrieveVectorChunks,
} from "./knowledge-embed";
import { addPastedSource, retrieveChunks } from "./knowledge";

/**
 * Offline the embedder falls back to 32-dim local vectors. Storing those under the *real* model id
 * makes a workspace look embedded when it is not, and it poisons the day the real model comes back:
 * two incompatible geometries under one id. They get their own id instead, and retrieval falls back
 * to it only when the configured model has nothing.
 */

function tenant(): TenantContext {
  return {
    organizationId: "org-stub-vec",
    workspaceId: `ws-stub-vec-${crypto.randomUUID()}`,
    userId: "user-stub-vec",
    role: "owner",
  };
}

function seedSource(ctx: TenantContext, id: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, 'seed', 'Paste', 'Indexed', 1, NULL, ?)`,
    )
    .run(id, ctx.workspaceId, Date.now());
}

function models(embeddingModel: string) {
  return { embeddingModel, brainModel: "gpt-5.6-luna", verifierModel: "deepseek-v4-flash" };
}

describe("stub vectors", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-stub-vec-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("stores fallback vectors under stub-fnv-32, never under the real model id", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    seedSource(ctx, sourceId);
    await indexSourceVectors(ctx, sourceId, ["vendor concentration risk"], DEFAULT_EMBEDDING_MODEL);

    expect(STUB_EMBED_MODEL).toBe("stub-fnv-32");
    expect(countVectorsForModel(ctx, DEFAULT_EMBEDDING_MODEL)).toBe(0);
    expect(countVectorsForModel(ctx, STUB_EMBED_MODEL)).toBe(1);
  });

  it("falls back to stub rows when the configured model has none, and serves them", async () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    seedSource(ctx, sourceId);
    await indexSourceVectors(ctx, sourceId, ["vendor concentration risk"], DEFAULT_EMBEDDING_MODEL);

    expect(resolveVectorModel(ctx, DEFAULT_EMBEDDING_MODEL)).toBe(STUB_EMBED_MODEL);
    const hits = await retrieveVectorChunks(ctx, "vendor concentration", models(DEFAULT_EMBEDDING_MODEL), 4);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.sourceId).toBe(sourceId);
  });

  it("prefers the configured model's own rows when it has any", () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    seedSource(ctx, sourceId);
    sql
      .prepare(
        `INSERT INTO knowledge_vectors (id, workspace_id, source_id, chunk_index, body, embedding, model, created_at)
         VALUES (?, ?, ?, 0, 'real body', ?, ?, ?)`,
      )
      .run(
        crypto.randomUUID(),
        ctx.workspaceId,
        sourceId,
        JSON.stringify(stubEmbed("real body")),
        "text-embedding-3-small",
        Date.now(),
      );

    expect(resolveVectorModel(ctx, "text-embedding-3-small")).toBe("text-embedding-3-small");
    expect(resolveVectorModel(ctx, "some-other-model")).toBe(null);
  });

  it("reports the vector model that served a retrieval", async () => {
    const ctx = tenant();
    await addPastedSource(ctx, "Vector model notes", "The mainsail budget is fixed for the quarter.");
    const served = await retrieveChunks(ctx, "mainsail budget", 4);
    expect(served.vectorModel).toBe(STUB_EMBED_MODEL);

    const empty = await retrieveChunks(tenant(), "nothing here at all", 4);
    expect(empty.vectorModel).toBe(null);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
