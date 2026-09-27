import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, stubEmbed, type TenantContext } from "@agentforge/core";
import { sql } from "@agentforge/db";
import {
  embedTexts,
  embedTextsWithModel,
  indexSourceVectors,
  resetEmbedCircuit,
  retrieveVectorChunks,
  STUB_EMBED_MODEL,
} from "./knowledge-embed";
import { getKnowledgeModels, indexKnowledgeSource, putKnowledgeModels } from "./knowledge";
import { saveSettings } from "./settings-store";

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-rag-test",
    workspaceId: `ws-rag-${crypto.randomUUID()}`,
    userId: "user-rag-test",
    role: "owner",
  };
}

describe("knowledge-embed", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-knowledge-embed-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    if (previousRuntime === undefined) {
      delete process.env.AGENTFORGE_RUNTIME;
    } else {
      process.env.AGENTFORGE_RUNTIME = previousRuntime;
    }
    if (previousSettings === undefined) {
      delete process.env.AGENTFORGE_SETTINGS_PATH;
    } else {
      process.env.AGENTFORGE_SETTINGS_PATH = previousSettings;
    }
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("stub-embeds texts and ranks matching vectors first", async () => {
    const ctx = tenant();
    const model = DEFAULT_EMBEDDING_MODEL;
    const hit = "vendor concentration risk in the spend table";
    const miss = "a recipe for tomato soup with basil";
    // Retrieval only serves vectors whose source row exists, so seed the two rows.
    const insertSource = sql.prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, ?, 'Paste', 'Indexed', 1, NULL, ?)`,
    );
    insertSource.run("src-hit", ctx.workspaceId, "hit", Date.now());
    insertSource.run("src-miss", ctx.workspaceId, "miss", Date.now());
    await indexSourceVectors(ctx, "src-hit", [hit], model);
    await indexSourceVectors(ctx, "src-miss", [miss], model);

    const ranked = await retrieveVectorChunks(
      ctx,
      "vendor concentration",
      {
        embeddingModel: model,
        brainModel: "gpt-5.6-luna",
        verifierModel: "deepseek-v4-flash",
      },
      4,
    );

    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0]?.body).toContain("vendor");
    expect(ranked[0]?.source).toBe("rag");
    expect(ranked[0]?.score ?? 0).toBeGreaterThan(ranked.find((row) => row.body.includes("tomato"))?.score ?? 0);

    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(ctx.workspaceId);
    sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ?").run(ctx.workspaceId);
  });

  it("returns empty retrieve for blank query", async () => {
    const ctx = tenant();
    expect(
      await retrieveVectorChunks(ctx, "   ", {
        embeddingModel: DEFAULT_EMBEDDING_MODEL,
        brainModel: "gpt-5.6-luna",
        verifierModel: "deepseek-v4-flash",
      }),
    ).toEqual([]);
  });

  it("stubEmbed batch matches cosine helper dims", async () => {
    const [a, b] = await embedTexts(["alpha", "beta"], DEFAULT_EMBEDDING_MODEL);
    expect(a).toEqual(stubEmbed("alpha"));
    expect(b).toEqual(stubEmbed("beta"));
  });

  it("retries one live timeout, then marks the source embed_local without a second flight", async () => {
    const previous = process.env.AGENTFORGE_RUNTIME;
    process.env.AGENTFORGE_RUNTIME = "ai";
    saveSettings({ openaiApiKey: "sk-test-embed-key-0001" });
    resetEmbedCircuit();
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      const error = new Error("The operation was aborted due to timeout");
      error.name = "TimeoutError";
      throw error;
    }) as typeof fetch;
    try {
      const ctx = tenant();
      const [first, second] = await Promise.all([
        embedTextsWithModel(["vendor concentration"], DEFAULT_EMBEDDING_MODEL),
        embedTextsWithModel(["another note"], DEFAULT_EMBEDDING_MODEL),
      ]);
      expect(fetches).toBe(2);
      expect(first.model).toBe(STUB_EMBED_MODEL);
      expect(first.degraded).toBe(true);
      expect(second.degraded).toBe(true);
      expect(second.vectors[0]).toEqual(stubEmbed("another note"));

      const saved = await indexKnowledgeSource(ctx, {
        id: "src-timeout",
        name: "Timed out",
        type: "Paste",
        text: "Vendor concentration stayed on a local index.",
      });
      expect(saved.status).toBe("Indexed");
      expect(saved.error).toBe("embed_local");
      const row = sql
        .prepare("SELECT status, error FROM knowledge_sources WHERE workspace_id = ? AND id = ?")
        .get(ctx.workspaceId, "src-timeout") as { status: string; error: string };
      expect(row.status).toBe("Indexed");
      expect(row.error).toBe("embed_local");
      expect(fetches).toBe(2);
    } finally {
      globalThis.fetch = original;
      resetEmbedCircuit();
      if (previous === undefined) {
        delete process.env.AGENTFORGE_RUNTIME;
      } else {
        process.env.AGENTFORGE_RUNTIME = previous;
      }
    }
  });

  it("does not retry a 400 from the embeddings endpoint", async () => {
    process.env.AGENTFORGE_RUNTIME = "ai";
    saveSettings({ openaiApiKey: "sk-test-embed-key-0001" });
    resetEmbedCircuit();
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      return new Response("no", { status: 400 });
    }) as typeof fetch;
    try {
      const result = await embedTextsWithModel(["alpha"], DEFAULT_EMBEDDING_MODEL);
      expect(fetches).toBe(1);
      expect(result.degraded).toBe(true);
      expect(result.model).toBe(STUB_EMBED_MODEL);
    } finally {
      globalThis.fetch = original;
      resetEmbedCircuit();
      process.env.AGENTFORGE_RUNTIME = "stub";
    }
  });

  it("keeps stub runtime off the degraded path", async () => {
    resetEmbedCircuit();
    const original = globalThis.fetch;
    let fetches = 0;
    globalThis.fetch = (async () => {
      fetches += 1;
      throw new Error("should not fetch");
    }) as typeof fetch;
    try {
      const result = await embedTextsWithModel(["alpha"], DEFAULT_EMBEDDING_MODEL);
      expect(fetches).toBe(0);
      expect(result.degraded).toBe(false);
      expect(result.model).toBe(STUB_EMBED_MODEL);
    } finally {
      globalThis.fetch = original;
    }
  });

  it("seeds knowledge models from catalog defaults then persists overrides", () => {
    const ctx = tenant();
    const seeded = getKnowledgeModels(ctx);
    expect(seeded.embeddingModel.length).toBeGreaterThan(0);
    expect(seeded.brainModel.length).toBeGreaterThan(0);
    expect(seeded.verifierModel.length).toBeGreaterThan(0);

    const saved = putKnowledgeModels(ctx, {
      embeddingModel: "text-embedding-3-large",
      brainModel: "gpt-5.6-sol",
      verifierModel: "minimax-m3",
    });
    expect(saved).toEqual({
      embeddingModel: "text-embedding-3-large",
      brainModel: "gpt-5.6-sol",
      verifierModel: "minimax-m3",
    });
    expect(getKnowledgeModels(ctx)).toEqual(saved);
    sql.prepare("DELETE FROM knowledge_settings WHERE workspace_id = ?").run(ctx.workspaceId);
  });
});
