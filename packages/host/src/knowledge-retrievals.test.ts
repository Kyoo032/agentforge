import { describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { countRetrievals, recordRetrievals, recordsRetrievals } from "./knowledge-retrievals";
import type { RetrievedChunk } from "./knowledge/backend";

function tenant(): TenantContext {
  return {
    organizationId: "org-retrievals-test",
    workspaceId: `ws-retrievals-${crypto.randomUUID()}`,
    userId: "user-retrievals-test",
    role: "owner",
  };
}

function chunk(index: number, score: number): RetrievedChunk {
  return { body: `body ${index}`, sourceId: `src-${index}`, sourceName: `Source ${index}`, score, chunkIndex: index };
}

describe("recordsRetrievals", () => {
  it("counts a clean completed run", () => {
    expect(recordsRetrievals(true, "completed")).toBe(true);
  });

  it("counts a run that broke mid-stream but still saved partial text", () => {
    // The error path finishes such a run as `completed`; it was given the same chunks.
    expect(recordsRetrievals(true, "completed")).toBe(true);
  });

  it("does not count a failed run, or one another writer already finished", () => {
    expect(recordsRetrievals(true, "failed")).toBe(false);
    expect(recordsRetrievals(false, "completed")).toBe(false);
    expect(recordsRetrievals(false, "failed")).toBe(false);
  });
});

describe("knowledge-retrievals", () => {
  it("writes one row per retrieved chunk and counts them per workspace", () => {
    const ctx = tenant();
    expect(countRetrievals(ctx)).toBe(0);

    expect(recordRetrievals(ctx, { threadId: "t-1", runId: "r-1", backend: "builtin", chunks: [chunk(0, 0.9), chunk(1, 0.4)] })).toBe(2);
    expect(countRetrievals(ctx)).toBe(2);

    const rows = sql
      .prepare("SELECT thread_id, run_id, source_id, chunk_index, score, backend FROM knowledge_retrievals WHERE workspace_id = ? ORDER BY chunk_index")
      .all(ctx.workspaceId) as Array<{
      thread_id: string | null;
      run_id: string | null;
      source_id: string;
      chunk_index: number;
      score: number;
      backend: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(
      expect.objectContaining({ thread_id: "t-1", run_id: "r-1", source_id: "src-0", chunk_index: 0, backend: "builtin" }),
    );
    expect(rows[0]?.score ?? 0).toBeCloseTo(0.9);

    // Another workspace never shows up in this one's count.
    recordRetrievals(tenant(), { threadId: "t-2", runId: "r-2", backend: "builtin", chunks: [chunk(0, 0.5)] });
    expect(countRetrievals(ctx)).toBe(2);
  });

  it("writes nothing for an empty retrieval and tolerates a missing thread / run", () => {
    const ctx = tenant();
    expect(recordRetrievals(ctx, { backend: "builtin", chunks: [] })).toBe(0);
    expect(countRetrievals(ctx)).toBe(0);

    expect(recordRetrievals(ctx, { backend: "builtin", chunks: [chunk(0, 0.1)] })).toBe(1);
    const row = sql
      .prepare("SELECT thread_id, run_id FROM knowledge_retrievals WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { thread_id: string | null; run_id: string | null };
    expect(row.thread_id).toBeNull();
    expect(row.run_id).toBeNull();
  });

  it("never throws when a chunk cannot be written", () => {
    const ctx = tenant();
    const bad = { ...chunk(0, 0.5), chunkIndex: Number.NaN as unknown as number, score: "nope" as unknown as number };
    expect(() => recordRetrievals(ctx, { threadId: "t", runId: "r", backend: "builtin", chunks: [bad] })).not.toThrow();
    expect(countRetrievals(ctx)).toBe(0);
  });
});
