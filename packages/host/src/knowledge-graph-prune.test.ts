import { describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { getGraph, upsertEdges, upsertNodes } from "./knowledge-graph";
import { removeGraphForSource, removeGraphForThread, sweepOrphanGraph } from "./knowledge-graph-prune";

/**
 * The delete side of the graph and the retrieval counter. Both projections used to outlive their
 * subject, so these tests care about one thing: after the subject is gone, nothing here still
 * describes it — and anything whose subject is alive is left alone.
 */

function tenant(): TenantContext {
  return {
    organizationId: `org-prune-${crypto.randomUUID()}`,
    workspaceId: `ws-prune-${crypto.randomUUID()}`,
    userId: "user-prune",
    role: "owner",
  };
}

function seedSource(ctx: TenantContext, id: string, name: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, ?, 'Paste', 'Indexed', 1, NULL, ?)`,
    )
    .run(id, ctx.workspaceId, name, Date.now());
}

/** A real `threads` row, parents and all: the sweep asks that table whether a thread node is alive. */
function seedThread(ctx: TenantContext, id: string, title: string): void {
  const agentId = `agent-${id}`;
  sql
    .prepare("INSERT OR IGNORE INTO organizations (id, name, slug, industry_pack, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(ctx.organizationId, "Prune org", ctx.organizationId, "generic", Date.now());
  sql
    .prepare("INSERT OR IGNORE INTO workspaces (id, organization_id, name, slug, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(ctx.workspaceId, ctx.organizationId, "Prune ws", ctx.workspaceId, Date.now());
  sql
    .prepare(
      `INSERT OR IGNORE INTO agents (id, organization_id, workspace_id, name, slug, created_by_user_id, created_at, updated_at)
       VALUES (?, ?, ?, 'Chat', ?, ?, ?, ?)`,
    )
    .run(agentId, ctx.organizationId, ctx.workspaceId, agentId, ctx.userId, Date.now(), Date.now());
  sql
    .prepare(
      `INSERT OR IGNORE INTO threads (id, organization_id, workspace_id, agent_id, user_id, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, ctx.organizationId, ctx.workspaceId, agentId, ctx.userId, title, Date.now());
}

function recordRetrieval(ctx: TenantContext, sourceId: string, threadId: string | null): void {
  sql
    .prepare(
      `INSERT INTO knowledge_retrievals (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
       VALUES (?, ?, ?, NULL, ?, 0, 0.5, 'builtin', ?)`,
    )
    .run(crypto.randomUUID(), ctx.workspaceId, threadId, sourceId, Date.now());
}

function retrievalCount(ctx: TenantContext): number {
  return (
    sql.prepare("SELECT count(*) AS n FROM knowledge_retrievals WHERE workspace_id = ?").get(ctx.workspaceId) as {
      n: number;
    }
  ).n;
}

describe("knowledge graph prune", () => {
  it("removes a source's node, every edge touching it, and its retrieval rows", () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const threadId = crypto.randomUUID();
    const topicId = "topic:prune";
    upsertNodes(ctx, [
      { id: sourceId, kind: "source", label: "Tarrow Ridge" },
      { id: threadId, kind: "thread", label: "Citation probe" },
      { id: topicId, kind: "topic", label: "Logistics" },
    ]);
    upsertEdges(ctx, [
      { from: sourceId, to: threadId, kind: "retrieved", weight: 2 },
      { from: sourceId, to: threadId, kind: "cites", weight: 1 },
      { from: topicId, to: sourceId, kind: "covers", weight: 1 },
    ]);
    recordRetrieval(ctx, sourceId, threadId);
    recordRetrieval(ctx, sourceId, threadId);

    const removed = removeGraphForSource(ctx, sourceId);
    expect(removed).toEqual({ nodes: 1, edges: 3, retrievals: 2 });

    const graph = getGraph(ctx, { limit: 50 });
    expect(graph.nodes.map((node) => node.id)).not.toContain(sourceId);
    expect(graph.edges).toHaveLength(0);
    expect(retrievalCount(ctx)).toBe(0);
  });

  it("removes a thread's node, its edges, and the retrievals recorded against it", () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const threadId = crypto.randomUUID();
    seedSource(ctx, sourceId, "Still here");
    upsertNodes(ctx, [
      { id: sourceId, kind: "source", label: "Still here" },
      { id: threadId, kind: "thread", label: "Gone" },
    ]);
    upsertEdges(ctx, [{ from: sourceId, to: threadId, kind: "retrieved", weight: 1 }]);
    recordRetrieval(ctx, sourceId, threadId);

    expect(removeGraphForThread(ctx, threadId)).toEqual({ nodes: 1, edges: 1, retrievals: 1 });
    const graph = getGraph(ctx, { limit: 50 });
    expect(graph.nodes.map((node) => node.id)).toEqual([sourceId]);
    expect(graph.edges).toHaveLength(0);
    expect(retrievalCount(ctx)).toBe(0);
  });

  it("sweeps nodes whose source or thread no longer exists and keeps the live ones", () => {
    const ctx = tenant();
    const liveSource = crypto.randomUUID();
    const deadSource = crypto.randomUUID();
    const liveThread = crypto.randomUUID();
    const deadThread = crypto.randomUUID();
    seedSource(ctx, liveSource, "Live source");
    seedThread(ctx, liveThread, "Live thread");
    upsertNodes(ctx, [
      { id: liveSource, kind: "source", label: "Live source" },
      { id: deadSource, kind: "source", label: "Deleted source" },
      { id: liveThread, kind: "thread", label: "Live thread" },
      { id: deadThread, kind: "thread", label: "Deleted thread" },
    ]);
    upsertEdges(ctx, [
      { from: liveSource, to: liveThread, kind: "retrieved", weight: 1 },
      { from: deadSource, to: deadThread, kind: "retrieved", weight: 1 },
      { from: deadSource, to: liveThread, kind: "cites", weight: 1 },
    ]);
    recordRetrieval(ctx, liveSource, liveThread);
    recordRetrieval(ctx, deadSource, liveThread);
    recordRetrieval(ctx, liveSource, deadThread);

    const swept = sweepOrphanGraph(ctx);
    expect(swept.nodes).toBe(2);
    expect(swept.edges).toBe(2);
    expect(swept.retrievals).toBe(2);

    const graph = getGraph(ctx, { limit: 50 });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([liveSource, liveThread].sort());
    expect(graph.edges).toEqual([{ from: liveSource, to: liveThread, kind: "retrieved", weight: 1 }]);
    expect(retrievalCount(ctx)).toBe(1);

    // Idempotent: a second pass over a healthy desk removes nothing.
    expect(sweepOrphanGraph(ctx)).toEqual({ nodes: 0, edges: 0, retrievals: 0 });
  });

  it("clears a desk shaped like the owner's: 18 nodes against one live source", () => {
    const ctx = tenant();
    // Modelled on the real desk the media/manual mapper measured: one source still in the Sources
    // list, twelve source nodes and four thread nodes left by deletes that predate the cascade, and
    // one topic whose only `covers` edge points at a source that is gone.
    const liveSource = crypto.randomUUID();
    seedSource(ctx, liveSource, "Pasted notes");
    const deadSources = Array.from({ length: 12 }, () => crypto.randomUUID());
    const deadThreads = Array.from({ length: 4 }, () => crypto.randomUUID());
    const deadThread = (index: number): string => deadThreads[index % deadThreads.length] ?? "";
    const topicId = "topic:e9674dee";
    upsertNodes(ctx, [
      { id: liveSource, kind: "source", label: "Pasted notes" },
      { id: topicId, kind: "topic", label: "Logistics" },
      ...deadSources.map((id) => ({ id, kind: "source" as const, label: "Deleted source" })),
      ...deadThreads.map((id) => ({ id, kind: "thread" as const, label: "Deleted thread" })),
    ]);
    upsertEdges(ctx, [
      { from: topicId, to: deadSources[0] ?? "", kind: "covers", weight: 1 },
      ...deadSources.map((id, index) => ({
        from: id,
        to: deadThread(index),
        kind: "retrieved" as const,
        weight: 1,
      })),
      ...deadThreads.map((id) => ({ from: liveSource, to: id, kind: "cites" as const, weight: 1 })),
    ]);
    for (const [index, id] of deadSources.entries()) {
      recordRetrieval(ctx, id, deadThread(index));
    }
    recordRetrieval(ctx, liveSource, deadThread(0));

    const before = sql
      .prepare("SELECT count(*) AS n FROM knowledge_graph_nodes WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { n: number };
    expect(before.n).toBe(18);

    // 16 nodes (12 dead sources + 4 dead threads), 17 edges (1 covers + 12 retrieved + 4 cites),
    // 13 retrieval rows. What survives is the live source and the topic, with no edges between them.
    expect(sweepOrphanGraph(ctx)).toEqual({ nodes: 16, edges: 17, retrievals: 13 });
    const graph = getGraph(ctx, { limit: 50 });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([liveSource, topicId].sort());
    expect(graph.edges).toHaveLength(0);
    expect(retrievalCount(ctx)).toBe(0);
  });

  it("never prunes a topic node, only its dangling covers edge", () => {
    const ctx = tenant();
    const liveSource = crypto.randomUUID();
    const deadSource = crypto.randomUUID();
    seedSource(ctx, liveSource, "Live source");
    const topicId = "topic:kept";
    upsertNodes(ctx, [
      { id: topicId, kind: "topic", label: "Logistics" },
      { id: liveSource, kind: "source", label: "Live source" },
      { id: deadSource, kind: "source", label: "Deleted source" },
    ]);
    upsertEdges(ctx, [
      { from: topicId, to: liveSource, kind: "covers", weight: 1 },
      { from: topicId, to: deadSource, kind: "covers", weight: 1 },
    ]);

    sweepOrphanGraph(ctx);
    const graph = getGraph(ctx, { limit: 50 });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual([liveSource, topicId].sort());
    expect(graph.edges).toEqual([{ from: topicId, to: liveSource, kind: "covers", weight: 1 }]);
  });
});
