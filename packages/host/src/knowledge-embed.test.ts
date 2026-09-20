import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_EMBEDDING_MODEL, stubEmbed, type TenantContext } from "@agentforge/core";
import { sql } from "@agentforge/db";
import { embedTexts, indexSourceVectors, retrieveVectorChunks } from "./knowledge-embed";
import { getKnowledgeModels, putKnowledgeModels } from "./knowledge";

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
      await retrieveVectorChunks(
        ctx,
        "   ",
        {
          embeddingModel: DEFAULT_EMBEDDING_MODEL,
          brainModel: "gpt-5.6-luna",
          verifierModel: "deepseek-v4-flash",
        },
      ),
    ).toEqual([]);
  });

  it("stubEmbed batch matches cosine helper dims", async () => {
    const [a, b] = await embedTexts(["alpha", "beta"], DEFAULT_EMBEDDING_MODEL);
    expect(a).toEqual(stubEmbed("alpha"));
    expect(b).toEqual(stubEmbed("beta"));
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
