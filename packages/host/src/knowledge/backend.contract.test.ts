import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import {
  addPastedSource,
  deleteSource,
  knowledgeInjection,
  listSources,
  retrieveChunks,
} from "../knowledge";
import { upsertWorkSource } from "../knowledge-ingest";
import { chatWorkCard } from "../work-cards";
import { getKnowledgeBackend } from "./registry";
import type { KnowledgeBackend } from "./backend";

/**
 * The shared backend contract. Phase 0 has one implementation (builtin); Phase 3 adds WeKnora to
 * this list and every assertion below has to hold for it unchanged.
 */
const BACKENDS: Array<{ id: string; make: () => KnowledgeBackend }> = [
  { id: "builtin", make: () => getKnowledgeBackend() },
];

/** A token that cannot appear anywhere else in the workspace, so a hit proves retrieval. */
function plantedToken(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function tenant(): TenantContext {
  return {
    organizationId: "org-backend-contract",
    workspaceId: `ws-backend-${crypto.randomUUID()}`,
    userId: "user-backend-contract",
    role: "owner",
  };
}

describe.each(BACKENDS)("knowledge backend contract: $id", ({ id, make }) => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-knowledge-contract-"));
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

  it("reports its id and health", async () => {
    const backend = make();
    expect(backend.id).toBe(id);
    await expect(backend.health()).resolves.toEqual(expect.objectContaining({ ok: true }));
  });

  it("retrieves a planted fact with source identity and a positive score", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const source = await addPastedSource(ctx, "Planted notes", `The internal code name is ${token} for this desk.`);
    expect(source.status).toBe("Indexed");

    const result = await retrieveChunks(ctx, token, 4);
    expect(["fts", "rag"]).toContain(result.mode);
    expect(result.chunks.length).toBeGreaterThan(0);
    const hit = result.chunks.find((chunk) => chunk.body.includes(token));
    expect(hit).toBeDefined();
    expect(hit?.sourceId).toBe(source.id);
    expect(hit?.sourceName).toBe("Planted notes");
    expect(hit?.score ?? 0).toBeGreaterThan(0);
    expect(hit?.chunkIndex).toBe(0);
  });

  it("ranks FTS hits by bm25 and scores them in (0, 1]", async () => {
    const ctx = tenant();
    const token = plantedToken();
    await addPastedSource(ctx, "Weak match", `A passing mention of ${token}.`);
    await addPastedSource(
      ctx,
      "Strong match",
      `${token} ${token} ${token} is the code name, and ${token} is repeated on purpose.`,
    );
    // Force the FTS path so bm25 ordering is what is under test.
    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(ctx.workspaceId);

    const result = await retrieveChunks(ctx, token, 4);
    expect(result.mode).toBe("fts");
    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0]?.sourceName).toBe("Strong match");
    for (const chunk of result.chunks) {
      expect(chunk.score).toBeGreaterThan(0);
      expect(chunk.score).toBeLessThanOrEqual(1);
    }
    expect(result.chunks[0]?.score ?? 0).toBeGreaterThanOrEqual(result.chunks[1]?.score ?? 0);
  });

  it("stops retrieving a source once it is deleted", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const source = await addPastedSource(ctx, "Doomed notes", `The code name is ${token}.`);
    expect((await retrieveChunks(ctx, token, 4)).chunks.length).toBeGreaterThan(0);

    expect(deleteSource(ctx, source.id)).toBe(true);
    const after = await retrieveChunks(ctx, token, 4);
    expect(after.chunks).toHaveLength(0);
    expect(after.mode).toBe("none");
    const vectors = sql
      .prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?")
      .get(ctx.workspaceId, source.id) as { n: number };
    expect(vectors.n).toBe(0);
  });

  it("keeps exactly one source row when the same origin is upserted twice", async () => {
    const ctx = tenant();
    const card = (assistantText: string) =>
      chatWorkCard({ threadId: "thread-contract", title: "Contract", userText: "code name?", assistantText });
    const first = await upsertWorkSource(ctx, card("The code name is alpha."));
    const second = await upsertWorkSource(ctx, card("The code name is beta."));
    if (first.status === "skipped" || second.status === "skipped") {
      throw new Error("unexpected skip");
    }
    expect(second.source.id).toBe(first.source.id);
    expect(listSources(ctx)).toHaveLength(1);
  });

  it("renders every injected chunk as [n] <sourceName> so a reply can cite it", async () => {
    const ctx = tenant();
    const token = plantedToken();
    await addPastedSource(ctx, "Citable notes", `The code name is ${token}.`);
    const injected = await knowledgeInjection(ctx, token);
    expect(injected.prompt).toContain("[1] Citable notes");
    expect(injected.prompt).toContain(token);
    expect(injected.chunks.length).toBeGreaterThan(0);
    const sourcesPart = injected.parts.find((part) => part.label === "Sources");
    expect(sourcesPart?.detail).toMatch(/^\d+ chunks · (rag|fts)$/);
  });
});
