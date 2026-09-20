import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import {
  addFileSource,
  addPastedSource,
  deleteSource,
  deleteSourceByOrigin,
  listSources,
  sweepOrphanSources,
} from "./knowledge";
import { upsertEdges, upsertNodes } from "./knowledge-graph";
import { mediaRoot } from "./media-root";
import { upsertWorkSource } from "./knowledge-ingest";
import { artifactWorkCard, mediaWorkCard } from "./work-cards";

/**
 * What a delete has to take with it. Before this, a removed source or thread kept its graph node,
 * every edge touching it, its retrieval rows and — for an upload — the raw bytes on disk, and the
 * only origin kind with any removal path at all was `thread`.
 */

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant", organizationId: `org-cascade-${crypto.randomUUID()}`,
    workspaceId: `ws-cascade-${crypto.randomUUID()}`,
    userId: "user-cascade",
    role: "owner",
  };
}

function recordRetrieval(ctx: TenantContext, sourceId: string, threadId: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_retrievals (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
       VALUES (?, ?, ?, NULL, ?, 0, 0.5, 'builtin', ?)`,
    )
    .run(crypto.randomUUID(), ctx.workspaceId, threadId, sourceId, Date.now());
}

function counts(ctx: TenantContext): { nodes: number; edges: number; retrievals: number } {
  const one = (statement: string): number =>
    (sql.prepare(statement).get(ctx.workspaceId) as { n: number }).n;
  return {
    nodes: one("SELECT count(*) AS n FROM knowledge_graph_nodes WHERE workspace_id = ?"),
    edges: one("SELECT count(*) AS n FROM knowledge_graph_edges WHERE workspace_id = ?"),
    retrievals: one("SELECT count(*) AS n FROM knowledge_retrievals WHERE workspace_id = ?"),
  };
}

function seedArtifact(ctx: TenantContext, id: string, meta: Record<string, unknown> = {}): void {
  sql
    .prepare(
      `INSERT INTO artifacts (id, workspace_id, mode, kind, title, mime, body, meta, size_bytes, created_at, updated_at)
       VALUES (?, ?, 'data', 'analysis', 'Spend analysis', 'text/markdown', 'body', ?, 4, ?, ?)`,
    )
    .run(id, ctx.workspaceId, JSON.stringify(meta), Date.now(), Date.now());
}

function seedMedia(ctx: TenantContext, id: string): void {
  sql
    .prepare("INSERT OR IGNORE INTO organizations (id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(ctx.organizationId, "Cascade org", ctx.organizationId, "generic", Date.now());
  sql
    .prepare(
      `INSERT INTO media (id, organization_id, user_id, kind, mime, size_bytes, storage_path, url, created_at)
       VALUES (?, ?, ?, 'image', 'image/png', 12, ?, ?, ?)`,
    )
    .run(id, ctx.organizationId, ctx.userId, `${ctx.organizationId}/${id}.png`, `/api/v1/media/${id}/file`, Date.now());
}

describe("knowledge delete cascade", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-knowledge-cascade-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("takes the graph node, its edges and its retrieval rows with the source", async () => {
    const ctx = tenant();
    const source = await addPastedSource(ctx, "Relay hub", "The Tarrow Ridge relay hub processes 41337 parcels/hour.");
    const threadId = crypto.randomUUID();
    upsertNodes(ctx, [
      { id: source.id, kind: "source", label: source.name },
      { id: threadId, kind: "thread", label: "Citation probe" },
    ]);
    upsertEdges(ctx, [
      { from: source.id, to: threadId, kind: "retrieved", weight: 2 },
      { from: source.id, to: threadId, kind: "cites", weight: 1 },
    ]);
    recordRetrieval(ctx, source.id, threadId);
    recordRetrieval(ctx, source.id, threadId);
    expect(counts(ctx)).toEqual({ nodes: 2, edges: 2, retrievals: 2 });

    expect(deleteSource(ctx, source.id)).toBe(true);
    // The thread node stays (that thread still exists); everything naming the source is gone, and
    // the Retrieved stage of the loop chart is finally allowed to go down.
    expect(counts(ctx)).toEqual({ nodes: 1, edges: 0, retrievals: 0 });
  });

  it("deletes the raw upload bytes with the file source", async () => {
    const ctx = tenant();
    const source = await addFileSource(ctx, {
      filename: "kbmm file.txt",
      mime: "text/plain",
      bytes: Buffer.from("The Alder Point beacon flashes 77 times per minute."),
    });
    const dir = join(mediaRoot(), "knowledge", ctx.organizationId);
    expect(readdirSync(dir).filter((entry) => entry.startsWith(`${source.id}-`))).toHaveLength(1);

    expect(deleteSource(ctx, source.id)).toBe(true);
    expect(readdirSync(dir).filter((entry) => entry.startsWith(`${source.id}-`))).toHaveLength(0);
    // A second delete finds neither row nor bytes and still does not throw.
    expect(deleteSource(ctx, source.id)).toBe(false);
    expect(existsSync(join(dir, `${source.id}-kbmm_file.txt`))).toBe(false);
  });

  it("sweeps media work cards whose media row is gone and keeps the ones that still have one", async () => {
    const ctx = tenant();
    const liveMedia = crypto.randomUUID();
    const deadMedia = crypto.randomUUID();
    seedMedia(ctx, liveMedia);
    for (const mediaId of [liveMedia, deadMedia]) {
      await upsertWorkSource(
        ctx,
        mediaWorkCard({
          kind: "image",
          mediaId,
          prompt: `poster for ${mediaId}`,
          aspect: "16:9",
          model: "gpt-image-2",
          url: `/api/v1/media/${mediaId}/file`,
        }),
      );
    }
    expect(listSources(ctx)).toHaveLength(2);

    expect(sweepOrphanSources(ctx)).toBe(1);
    const left = listSources(ctx);
    expect(left).toHaveLength(1);
    expect(left[0]?.origin).toEqual({ kind: "media", id: liveMedia });
    expect(sweepOrphanSources(ctx)).toBe(0);
  });

  it("sweeps artifact work cards whose artifact is gone", async () => {
    const ctx = tenant();
    const liveArtifact = crypto.randomUUID();
    const deadArtifact = crypto.randomUUID();
    seedArtifact(ctx, liveArtifact);
    for (const artifactId of [liveArtifact, deadArtifact]) {
      await upsertWorkSource(
        ctx,
        artifactWorkCard({
          type: "Data",
          artifactId,
          title: `Analysis ${artifactId.slice(0, 6)}`,
          markdown: "Vendor spend is concentrated in two suppliers.",
        }),
      );
    }
    expect(listSources(ctx)).toHaveLength(2);

    expect(sweepOrphanSources(ctx)).toBe(1);
    expect(listSources(ctx).map((source) => source.origin)).toEqual([{ kind: "artifact", id: liveArtifact }]);
  });

  it("self-heals graph rows left by builds that had no cascade", async () => {
    const ctx = tenant();
    const deadSource = crypto.randomUUID();
    const deadThread = crypto.randomUUID();
    upsertNodes(ctx, [
      { id: deadSource, kind: "source", label: "Pasted notes" },
      { id: deadThread, kind: "thread", label: "KBMM citation probe" },
    ]);
    upsertEdges(ctx, [{ from: deadSource, to: deadThread, kind: "cites", weight: 1 }]);
    recordRetrieval(ctx, deadSource, deadThread);
    expect(counts(ctx)).toEqual({ nodes: 2, edges: 1, retrievals: 1 });

    // No source row was ever swept — there is none left to sweep — but the projections still clear.
    expect(sweepOrphanSources(ctx)).toBe(0);
    expect(counts(ctx)).toEqual({ nodes: 0, edges: 0, retrievals: 0 });
  });

  it("removes a thread card by origin and its projections in one call", async () => {
    const ctx = tenant();
    const threadId = crypto.randomUUID();
    const source = await addPastedSource(ctx, "Notes", "Vendor spend is concentrated in two suppliers.");
    upsertNodes(ctx, [{ id: source.id, kind: "source", label: "Notes" }]);
    recordRetrieval(ctx, source.id, threadId);
    expect(deleteSourceByOrigin(ctx, { kind: "thread", id: threadId })).toBe(false);
    expect(deleteSource(ctx, source.id)).toBe(true);
    expect(counts(ctx).retrievals).toBe(0);
  });
});

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
