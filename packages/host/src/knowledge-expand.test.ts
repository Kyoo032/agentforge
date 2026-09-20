import { describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import type { RetrievedChunk, RetrieveResult } from "./knowledge/backend";
import { topicNodeId, upsertEdges, upsertNodes } from "./knowledge-graph";
import { EXPAND_CHUNK_CAP, EXPAND_TOP_SCORE_THRESHOLD, expandRetrievedChunks, isGraphExpandedChunk } from "./knowledge-expand";

/**
 * Phase 4's Graph -> Retrieved edge. When the top hit is weak, the topics that cover its source name
 * sibling sources, and the first chunk of each sibling rides along, labelled `via graph` and capped
 * at two. The graph is seeded through the same `upsertNodes` / `upsertEdges` the map projection
 * uses, so this exercises real `covers` edges rather than a graph stub.
 */

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-expand",
    workspaceId: `ws-expand-${crypto.randomUUID()}`,
    userId: "user-expand",
    role: "owner",
  };
}

/** Source ids are unique across the whole database, not per workspace, so every seed carries a tag. */
function tagged(): (name: string) => string {
  const tag = crypto.randomUUID().slice(0, 8);
  return (name) => `${name}-${tag}`;
}

/** A source row plus its chunk bodies, written the way `replaceSourceRows` writes them. */
function seedSource(ctx: TenantContext, id: string, name: string, bodies: string[]): void {
  sql
    .prepare(
      `INSERT INTO knowledge_sources (id, workspace_id, name, type, status, chunks, error, created_at)
       VALUES (?, ?, ?, 'Paste', 'Indexed', ?, NULL, ?)`,
    )
    .run(id, ctx.workspaceId, name, bodies.length, Date.now());
  const insert = sql.prepare("INSERT INTO knowledge_chunks (source_id, workspace_id, body) VALUES (?, ?, ?)");
  for (const body of bodies) {
    insert.run(id, ctx.workspaceId, body);
  }
}

/** One topic covering each source — exactly the shape `projectMapToGraph` writes. */
function seedTopic(ctx: TenantContext, title: string, sourceIds: string[]): void {
  const topicId = topicNodeId(ctx.workspaceId, title);
  upsertNodes(ctx, [
    { id: topicId, kind: "topic", label: title },
    ...sourceIds.map((id) => ({ id, kind: "source" as const, label: id })),
  ]);
  upsertEdges(
    ctx,
    sourceIds.map((id) => ({ from: topicId, to: id, kind: "covers" as const })),
  );
}

function hit(sourceId: string, over: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    body: `${sourceId} chunk`,
    sourceId,
    sourceName: `Name of ${sourceId}`,
    score: 0.2,
    chunkIndex: 0,
    ...over,
  };
}

function retrieval(chunks: RetrievedChunk[]): RetrieveResult {
  return { chunks, mode: "hybrid", backend: "builtin", vectorModel: "text-embedding-3-small" };
}

describe("knowledge graph expansion", () => {
  it("does nothing while the flag is off, even with siblings and a weak top hit", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib"), "Sibling note", ["sibling chunk"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib")]);

    const after = expandRetrievedChunks(ctx, retrieval([hit(id("src-top"), { score: 0.01 })]));

    expect(after.chunks.map((chunk) => chunk.sourceId)).toEqual([id("src-top")]);
  });

  it("adds the sibling's first chunk, labelled via graph, when the top hit is below the threshold", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib"), "Sibling note", ["sibling first", "sibling second"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib")]);

    const before = retrieval([hit(id("src-top"), { score: 0.2 })]);
    const after = expandRetrievedChunks(ctx, before, { expand: true });

    expect(before.chunks).toHaveLength(1); // the input result is never mutated
    expect(after.chunks).toHaveLength(2);
    const extra = after.chunks[1];
    expect(extra.sourceId).toBe(id("src-sib"));
    expect(extra.sourceName).toBe("Sibling note");
    expect(extra.body).toBe("sibling first"); // one chunk per sibling, in chunker order
    expect(extra.chunkIndex).toBe(0);
    expect(extra.score).toBe(0); // the graph does not score; an extra never outranks a real hit
    expect(isGraphExpandedChunk(extra)).toBe(true);
    expect((extra as RetrievedChunk & { via?: string }).via).toBe("graph");
    expect(isGraphExpandedChunk(after.chunks[0])).toBe(false);
    // The result keeps the engine's own story; expansion is not a mode.
    expect(after.mode).toBe("hybrid");
    expect(after.backend).toBe("builtin");
    expect(after.vectorModel).toBe("text-embedding-3-small");
  });

  it("stays out of the way when the top score is not below the threshold", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib"), "Sibling note", ["sibling chunk"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib")]);

    const atThreshold = expandRetrievedChunks(
      ctx,
      retrieval([hit(id("src-top"), { score: EXPAND_TOP_SCORE_THRESHOLD })]),
      { expand: true },
    );
    const above = expandRetrievedChunks(ctx, retrieval([hit(id("src-top"), { score: 0.9 })]), { expand: true });

    expect(atThreshold.chunks).toHaveLength(1);
    expect(above.chunks).toHaveLength(1);
  });

  it("caps the expansion at two chunks, walking the graph's own edge order", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib-a"), "Sib A", ["a chunk"]);
    seedSource(ctx, id("src-sib-b"), "Sib B", ["b chunk"]);
    seedSource(ctx, id("src-sib-c"), "Sib C", ["c chunk"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib-a"), id("src-sib-b"), id("src-sib-c")]);

    const after = expandRetrievedChunks(ctx, retrieval([hit(id("src-top"), { score: 0.1 })]), { expand: true });

    expect(after.chunks).toHaveLength(1 + EXPAND_CHUNK_CAP);
    expect(after.chunks.slice(1).map((chunk) => chunk.sourceId)).toEqual([id("src-sib-a"), id("src-sib-b")]);
  });

  it("never expands into a source that was already served or excluded", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib-a"), "Sib A", ["a chunk"]);
    seedSource(ctx, id("src-sib-b"), "Sib B", ["b chunk"]);
    seedSource(ctx, id("src-sib-c"), "Sib C", ["c chunk"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib-a"), id("src-sib-b"), id("src-sib-c")]);

    const before = retrieval([hit(id("src-top"), { score: 0.1 }), hit(id("src-sib-a"), { score: 0.05 })]);
    const after = expandRetrievedChunks(ctx, before, { expand: true, excludeSourceIds: [id("src-sib-b")] });

    expect(after.chunks).toHaveLength(3);
    expect(after.chunks[2].sourceId).toBe(id("src-sib-c"));
    expect(isGraphExpandedChunk(after.chunks[2])).toBe(true);
  });

  it("is a no-op without covers edges or without chunks at all", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib"), "Sibling note", ["sibling chunk"]); // related in real life, no topic yet

    const noTopic = expandRetrievedChunks(ctx, retrieval([hit(id("src-top"), { score: 0.1 })]), { expand: true });
    const empty = expandRetrievedChunks(ctx, retrieval([]), { expand: true });

    expect(noTopic.chunks).toHaveLength(1);
    expect(empty.chunks).toHaveLength(0);
  });

  it("moves past a sibling with no chunks instead of spending the cap on it", () => {
    const ctx = tenant();
    const id = tagged();
    seedSource(ctx, id("src-top"), "Top note", ["top chunk"]);
    seedSource(ctx, id("src-sib-a"), "Sib A", []); // a Failed card: covered by the topic, nothing to serve
    seedSource(ctx, id("src-sib-b"), "Sib B", ["b chunk"]);
    seedTopic(ctx, "One topic", [id("src-top"), id("src-sib-a"), id("src-sib-b")]);

    const after = expandRetrievedChunks(ctx, retrieval([hit(id("src-top"), { score: 0.1 })]), { expand: true });

    expect(after.chunks).toHaveLength(2);
    expect(after.chunks[1].sourceId).toBe(id("src-sib-b"));
    expect(after.chunks[1].body).toBe("b chunk");
  });
});