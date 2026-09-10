import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { addPastedSource, retrieveChunks } from "../../knowledge";
import { CHUNK_INDEX_QUERIES } from "./builtin";

/**
 * The FTS fallback used to resolve a hit's chunk index by reading every row of `knowledge_chunks`
 * for the hit sources — an unqualified read of an FTS5 table, which SQLite can only answer with a
 * full scan. These tests pin both the plan and the answers it produces.
 */

function tenant(): TenantContext {
  return {
    organizationId: "org-builtin-plan",
    workspaceId: `ws-builtin-${crypto.randomUUID()}`,
    userId: "user-builtin-plan",
    role: "owner",
  };
}

function plantedToken(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function plan(query: string, params: unknown[]): string {
  const rows = sql.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...(params as never[])) as Array<{ detail: string }>;
  return rows.map((row) => row.detail).join(" | ");
}

describe("builtin backend chunk-index lookups", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-builtin-plan-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("resolves chunk indexes from knowledge_vectors with an indexed lookup", () => {
    const detail = plan(CHUNK_INDEX_QUERIES.vectors(2), ["ws", "s1", "s2"]);
    expect(detail).toMatch(/knowledge_vectors_ws_source_idx/);
    expect(detail).not.toMatch(/SCAN knowledge_vectors\b(?! USING)/);
  });

  it("never reads knowledge_chunks without a MATCH", () => {
    const detail = plan(CHUNK_INDEX_QUERIES.ftsBySource, ['source_id:"s1"', "ws"]);
    // FTS5 reports its MATCH-driven plan as a "VIRTUAL TABLE INDEX" with a non-zero index number;
    // "INDEX 0:" is the full-table scan the old query produced.
    expect(detail).toMatch(/knowledge_chunks VIRTUAL TABLE INDEX/);
    expect(detail).not.toMatch(/knowledge_chunks VIRTUAL TABLE INDEX 0:/);
  });

  it("still reports the right chunk index on the FTS path when vectors exist", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const filler = "q".repeat(900);
    await addPastedSource(ctx, "Two chunk notes", `${filler}\n\nThe code name is ${token}.`);

    const result = await retrieveChunks(ctx, token, 4);
    const hit = result.chunks.find((chunk) => chunk.body.includes(token));
    expect(hit?.chunkIndex).toBe(1);
  });

  it("falls back to rank-among-rowids when a source has no vectors", async () => {
    const ctx = tenant();
    const token = plantedToken();
    const filler = "q".repeat(900);
    await addPastedSource(ctx, "Vectorless notes", `${filler}\n\nThe code name is ${token}.`);
    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(ctx.workspaceId);

    const result = await retrieveChunks(ctx, token, 4);
    expect(result.mode).toBe("fts");
    const hit = result.chunks.find((chunk) => chunk.body.includes(token));
    expect(hit?.chunkIndex).toBe(1);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
