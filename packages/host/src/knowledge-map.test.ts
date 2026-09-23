import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sql } from "@agentforge/db";
import type { KnowledgeMap, TenantContext } from "@agentforge/core";
import { mapKnowledge, getKnowledgeMap } from "./knowledge-map";

/** Runs inside the re-embed step of a map, i.e. after the map has started and before it is ready. */
const embedStep = vi.hoisted(() => ({ during: null as null | (() => void) }));

vi.mock("./knowledge-embed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledge-embed")>();
  return {
    ...actual,
    reembedWorkspaceChunks: async (...args: Parameters<typeof actual.reembedWorkspaceChunks>) => {
      embedStep.during?.();
      return actual.reembedWorkspaceChunks(...args);
    },
  };
});

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
    embedStep.during = null;
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
    const sourceId = seedSource(ctx, "Spend notes", "vendor concentration risk");

    const map = await mapKnowledge(ctx);
    expect(map.source).toBe("stub");
    expect(map.ready).toBe(true);
    expect(map.topics.some((topic) => topic.sourceIds.includes(sourceId))).toBe(true);
    expect(getKnowledgeMap(ctx)?.overview).toBe(map.overview);

    cleanup(ctx);
  });

  // A re-map used to blank the saved map before it started and again when it failed, so one
  // embedding hiccup cost the desk the map it already had.
  it("keeps serving the last good map while a re-map runs and after it fails", async () => {
    const ctx = tenant();
    seedSource(ctx, "Spend notes", "vendor concentration risk");
    const good = await mapKnowledge(ctx);

    let during: KnowledgeMap | null | undefined;
    let statusDuring: string | undefined;
    embedStep.during = () => {
      during = getKnowledgeMap(ctx);
      statusDuring = mapRow(ctx)?.status;
      throw new Error("embedding backend down");
    };
    await expect(mapKnowledge(ctx)).rejects.toMatchObject({
      code: "generation_failed",
      message: "embedding backend down",
    });

    expect(statusDuring).toBe("Mapping");
    expect(during).toEqual(good);
    expect(getKnowledgeMap(ctx)).toEqual(good);
    expect(mapRow(ctx)).toMatchObject({ status: "Failed", error: "embedding backend down" });
    cleanup(ctx);
  });

  it("reports a first map that fails without inventing one", async () => {
    const ctx = tenant();
    seedSource(ctx, "Spend notes", "vendor concentration risk");
    embedStep.during = () => {
      throw new Error("embedding backend down");
    };

    await expect(mapKnowledge(ctx)).rejects.toMatchObject({ code: "generation_failed" });

    expect(getKnowledgeMap(ctx)).toBeNull();
    expect(mapRow(ctx)).toMatchObject({ status: "Failed", error: "embedding backend down" });
    cleanup(ctx);
  });

  it("replaces the map once the new one is ready and clears the last error", async () => {
    const ctx = tenant();
    seedSource(ctx, "Spend notes", "vendor concentration risk");
    embedStep.during = () => {
      throw new Error("embedding backend down");
    };
    await expect(mapKnowledge(ctx)).rejects.toMatchObject({ code: "generation_failed" });
    embedStep.during = null;

    const second = seedSource(ctx, "Board minutes", "quarterly budget review");
    const map = await mapKnowledge(ctx);

    expect(map.topics.some((topic) => topic.sourceIds.includes(second))).toBe(true);
    expect(getKnowledgeMap(ctx)).toEqual(map);
    expect(mapRow(ctx)).toMatchObject({ status: "Mapped", error: null });
    cleanup(ctx);
  });
});

function seedSource(ctx: TenantContext, name: string, body: string): string {
  const sourceId = `src-${crypto.randomUUID()}`;
  sql
    .prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
    )
    .run(sourceId, ctx.workspaceId, name, "Paste", "Indexed", 1, Date.now());
  sql
    .prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)")
    .run(sourceId, ctx.workspaceId, body);
  return sourceId;
}

function mapRow(ctx: TenantContext): { status: string; error: string | null } | undefined {
  return sql.prepare("SELECT status, error FROM knowledge_maps WHERE workspace_id = ?").get(ctx.workspaceId) as
    | { status: string; error: string | null }
    | undefined;
}

function cleanup(ctx: TenantContext): void {
  sql.prepare("DELETE FROM knowledge_vectors WHERE workspace_id = ?").run(ctx.workspaceId);
  sql.prepare("DELETE FROM knowledge_chunks WHERE workspace_id = ?").run(ctx.workspaceId);
  sql.prepare("DELETE FROM knowledge_sources WHERE workspace_id = ?").run(ctx.workspaceId);
  sql.prepare("DELETE FROM knowledge_maps WHERE workspace_id = ?").run(ctx.workspaceId);
  sql.prepare("DELETE FROM knowledge_settings WHERE workspace_id = ?").run(ctx.workspaceId);
}
