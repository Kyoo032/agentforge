import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { mapKnowledge, getKnowledgeMap } from "./knowledge-map";

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-map-test",
    workspaceId: `ws-map-${crypto.randomUUID()}`,
    userId: "user-map-test",
    role: "owner",
  };
}

describe("knowledge-map", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-knowledge-map-"));
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

  it("builds and persists a stub map", async () => {
    const ctx = tenant();
    const sourceId = `src-${crypto.randomUUID()}`;
    const createdAt = Date.now();
    sql
      .prepare(
        `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
      )
      .run(sourceId, ctx.workspaceId, "Spend notes", "Paste", "Indexed", 1, createdAt);
    sql
      .prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)")
      .run(sourceId, ctx.workspaceId, "vendor concentration risk");

    const map = await mapKnowledge(ctx);
    expect(map.source).toBe("stub");
    expect(map.ready).toBe(true);
    expect(map.topics.some((topic) => topic.sourceIds.includes(sourceId))).toBe(true);
    expect(getKnowledgeMap(ctx)?.overview).toBe(map.overview);

    sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(ctx.workspaceId);
    sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ?").run(ctx.workspaceId);
    sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ?").run(ctx.workspaceId);
    sql.prepare("DELETE FROM knowledge_maps WHERE workspace_id = ?").run(ctx.workspaceId);
    sql.prepare("DELETE FROM knowledge_settings WHERE workspace_id = ?").run(ctx.workspaceId);
  });
});
