import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { KnowledgeMap, TenantContext } from "@agentforge/core";
import { mapKnowledge } from "./knowledge-map";
import { recordRetrievals } from "./knowledge-retrievals";
import {
  GRAPH_NODE_QUERY,
  RETRIEVAL_GRAPH_WINDOW_MS,
  getGraph,
  graphCounts,
  projectMapToGraph,
  projectRetrievalsToGraph,
  topicNodeId,
  upsertEdges,
  upsertNodes,
} from "./knowledge-graph";

/**
 * The Graph stage of the knowledge loop. Both projections are recomputed from their source of
 * record (the map blob, the retrieval counter), so running them twice must change nothing.
 */

function tenant(): TenantContext {
  return {
    organizationId: "org-graph",
    workspaceId: `ws-graph-${crypto.randomUUID()}`,
    userId: "user-graph",
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

function recordRetrieval(ctx: TenantContext, sourceId: string, threadId: string): void {
  sql
    .prepare(
      `INSERT INTO knowledge_retrievals
         (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0.5, 'builtin', ?)`,
    )
    .run(crypto.randomUUID(), ctx.workspaceId, threadId, crypto.randomUUID(), sourceId, Date.now());
}

function recordRetrievalAt(ctx: TenantContext, sourceId: string, threadId: string, createdAt: number): void {
  sql
    .prepare(
      `INSERT INTO knowledge_retrievals
         (id, workspace_id, thread_id, run_id, source_id, chunk_index, score, backend, created_at)
       VALUES (?, ?, ?, ?, ?, 0, 0.5, 'builtin', ?)`,
    )
    .run(crypto.randomUUID(), ctx.workspaceId, threadId, crypto.randomUUID(), sourceId, createdAt);
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function fixtureMap(sourceIds: string[]): KnowledgeMap {
  return {
    overview: "Two topics over the planted sources.",
    topics: [
      {
        title: "Vendor concentration",
        summary: "Spend is concentrated in two vendors.",
        sourceIds,
        verdict: "supported",
        note: "",
      },
      { title: "Unbacked claim", summary: "Nothing supports this.", sourceIds: [], verdict: "unsupported", note: "" },
    ],
    gaps: [],
    ready: true,
    source: "stub",
    embeddingModel: "text-embedding-3-small",
    brainModel: "gpt-5.6-luna",
    verifierModel: "deepseek-v4-flash",
    createdAt: Date.now(),
  };
}

describe("knowledge graph", () => {
  it("writes topic nodes and covers edges from a map", () => {
    const ctx = tenant();
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    seedSource(ctx, first, "Spend table");
    seedSource(ctx, second, "Vendor memo");

    const written = projectMapToGraph(ctx, fixtureMap([first, second]));
    expect(written.edges).toBe(2);

    const graph = getGraph(ctx, { limit: 50 });
    const topic = graph.nodes.find((node) => node.kind === "topic" && node.label === "Vendor concentration");
    expect(topic?.id).toBe(topicNodeId(ctx.workspaceId, "Vendor concentration"));
    expect(graph.nodes.filter((node) => node.kind === "source").map((node) => node.label).sort()).toEqual([
      "Spend table",
      "Vendor memo",
    ]);
    expect(graph.edges.filter((edge) => edge.kind === "covers")).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.from === topic?.id)).toBe(true);
  });

  it("is idempotent: a second projection of the same map changes nothing", () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    seedSource(ctx, sourceId, "Spend table");
    const map = fixtureMap([sourceId]);

    projectMapToGraph(ctx, map);
    const once = graphCounts(ctx);
    projectMapToGraph(ctx, map);
    expect(graphCounts(ctx)).toEqual(once);
  });

  it("aggregates retrievals into one weighted source -> thread edge", () => {
    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const threadId = crypto.randomUUID();
    seedSource(ctx, sourceId, "Spend table");
    recordRetrieval(ctx, sourceId, threadId);

    projectRetrievalsToGraph(ctx, [sourceId]);
    const first = getGraph(ctx, { limit: 50 }).edges.find((edge) => edge.kind === "retrieved");
    expect(first).toMatchObject({ from: sourceId, to: threadId, weight: 1 });

    recordRetrieval(ctx, sourceId, threadId);
    projectRetrievalsToGraph(ctx, [sourceId]);
    const edges = getGraph(ctx, { limit: 50 }).edges.filter((edge) => edge.kind === "retrieved");
    expect(edges).toHaveLength(1);
    expect(edges[0]?.weight).toBe(2);
  });

  it("caps getGraph at the limit, highest-degree nodes first", () => {
    const ctx = tenant();
    const hub = crypto.randomUUID();
    upsertNodes(ctx, [{ id: hub, kind: "source", label: "Hub" }]);
    const leaves = [0, 1, 2, 3].map(() => crypto.randomUUID());
    upsertNodes(
      ctx,
      leaves.map((id) => ({ id, kind: "thread" as const, label: `Leaf ${id.slice(0, 4)}` })),
    );
    upsertEdges(
      ctx,
      leaves.map((id) => ({ from: hub, to: id, kind: "retrieved" as const, weight: 1 })),
    );

    const graph = getGraph(ctx, { limit: 2 });
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0]?.id).toBe(hub);
    // Every returned edge has both ends in the returned node set, so the client can draw it.
    const ids = new Set(graph.nodes.map((node) => node.id));
    expect(graph.edges.every((edge) => ids.has(edge.from) && ids.has(edge.to))).toBe(true);
  });

  it("aggregates only the last 90 days, and only the sources of this run", () => {
    // This projection runs after every reply, so it must never re-read a workspace's whole history.
    expect(RETRIEVAL_GRAPH_WINDOW_MS).toBe(90 * 24 * 60 * 60 * 1000);

    const ctx = tenant();
    const sourceId = crypto.randomUUID();
    const other = crypto.randomUUID();
    const threadId = crypto.randomUUID();
    seedSource(ctx, sourceId, "Spend table");
    seedSource(ctx, other, "Old memo");
    const now = Date.now();
    recordRetrievalAt(ctx, sourceId, threadId, now - RETRIEVAL_GRAPH_WINDOW_MS - 60_000);
    recordRetrievalAt(ctx, sourceId, threadId, now);
    recordRetrievalAt(ctx, other, threadId, now);

    projectRetrievalsToGraph(ctx, [sourceId]);
    const edges = getGraph(ctx, { limit: 50 }).edges.filter((edge) => edge.kind === "retrieved");
    // One edge: the out-of-window row is not counted, and the untouched source is not projected.
    expect(edges).toEqual([{ from: sourceId, to: threadId, kind: "retrieved", weight: 1 }]);
  });

  it("never throws when the retrieval projection cannot read", () => {
    expect(() => projectRetrievalsToGraph(tenant(), ["nope"])).not.toThrow();
  });

  it("picks the capped node set in SQL, not by sorting the whole workspace in memory", () => {
    // A workspace with thousands of nodes must not read them all to draw fifty: the ordering and
    // the cap belong in the statement.
    expect(GRAPH_NODE_QUERY).toMatch(/ORDER BY/i);
    expect(GRAPH_NODE_QUERY).toMatch(/LIMIT \?/i);

    const ctx = tenant();
    const hub = crypto.randomUUID();
    const leaves = [0, 1, 2, 3, 4].map(() => crypto.randomUUID());
    upsertNodes(ctx, [
      { id: hub, kind: "source", label: "Hub" },
      ...leaves.map((id) => ({ id, kind: "thread" as const, label: `Leaf ${id.slice(0, 4)}` })),
    ]);
    upsertEdges(
      ctx,
      leaves.map((id) => ({ from: hub, to: id, kind: "retrieved" as const, weight: 1 })),
    );

    const graph = getGraph(ctx, { limit: 3 });
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes[0]?.id).toBe(hub);
    expect(graph.nodes.every((node) => "kind" in node && "label" in node)).toBe(true);
    // Deterministic: the same database answers the same way twice.
    expect(getGraph(ctx, { limit: 3 })).toEqual(graph);
  });

  it("is fed by mapKnowledge and by recordRetrievals", async () => {
    const previousRuntime = process.env.AGENTFORGE_RUNTIME;
    const previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    const settingsDir = mkdtempSync(join(tmpdir(), "af-graph-wiring-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
    try {
      const ctx = tenant();
      const sourceId = crypto.randomUUID();
      seedSource(ctx, sourceId, "Spend notes");
      sql
        .prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)")
        .run(sourceId, ctx.workspaceId, "vendor concentration risk");

      await mapKnowledge(ctx);
      expect(graphCounts(ctx).edges).toBeGreaterThan(0);

      const threadId = crypto.randomUUID();
      recordRetrievals(ctx, {
        threadId,
        runId: crypto.randomUUID(),
        backend: "builtin",
        chunks: [
          { body: "vendor concentration risk", sourceId, sourceName: "Spend notes", score: 0.5, chunkIndex: 0 },
        ],
      });
      const retrieved = getGraph(ctx, { limit: 50 }).edges.filter((edge) => edge.kind === "retrieved");
      expect(retrieved).toEqual([{ from: sourceId, to: threadId, kind: "retrieved", weight: 1 }]);
    } finally {
      restoreEnv("AGENTFORGE_RUNTIME", previousRuntime);
      restoreEnv("AGENTFORGE_SETTINGS_PATH", previousSettings);
      rmSync(settingsDir, { recursive: true, force: true });
    }
  });

  it("counts nodes and edges for the loop chart", () => {
    const ctx = tenant();
    expect(graphCounts(ctx)).toEqual({ nodes: 0, edges: 0 });
    const sourceId = crypto.randomUUID();
    seedSource(ctx, sourceId, "Spend table");
    projectMapToGraph(ctx, fixtureMap([sourceId]));
    const counts = graphCounts(ctx);
    expect(counts.nodes).toBe(3);
    expect(counts.edges).toBe(1);
  });
});
