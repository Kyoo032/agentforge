import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { addPastedSource, deleteSource, knowledgeInjection, retrieveChunks } from "../../../knowledge";
import { getExternalId, getWorkspaceBinding } from "../../backend-store";
import { outboxDepth, pendingOutbox } from "../../outbox";
import { drainKnowledgeOutbox, knowledgeBackendState } from "../../registry";
import { runBackfill } from "../../backfill";
import { loadWeknoraSecrets } from "./secrets";
import { startWeKnoraHarness, type WeKnoraHarness } from "./__fixtures__/harness";

/**
 * The WeKnora backend end to end against a fake sidecar: bootstrap, ingest, retrieval, delete, and
 * — the part that actually matters in the field — what happens when the sidecar goes away.
 */

let harness: WeKnoraHarness;

function tenant(): TenantContext {
  return {
    organizationId: "org-weknora",
    workspaceId: `ws-weknora-${crypto.randomUUID()}`,
    userId: "user-weknora",
    role: "owner",
  };
}

function token(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

beforeEach(async () => {
  harness = await startWeKnoraHarness();
});

afterEach(async () => {
  await harness.teardown();
});

describe("weknora bootstrap", () => {
  it("runs auto-setup once and reuses the key on the next call", async () => {
    const ctx = tenant();
    await expect(harness.backend.prepare(ctx)).resolves.toMatchObject({ ok: true });
    const first = loadWeknoraSecrets();
    expect(first.apiKey).toBeTruthy();
    expect(first.tenantId).toBe("1");

    await expect(harness.backend.prepare(tenant())).resolves.toMatchObject({ ok: true });
    const second = loadWeknoraSecrets();
    expect(second.apiKey).toBe(first.apiKey);
    expect(harness.fake.calls().filter((call) => call.endsWith("/auth/auto-setup"))).toHaveLength(1);
  });

  it("binds one knowledge base per workspace and reuses it", async () => {
    const ctx = tenant();
    await harness.backend.prepare(ctx);
    const binding = getWorkspaceBinding(ctx, "weknora");
    expect(binding?.kbId).toMatch(/^kb-/);
    expect(binding?.modelId).toMatch(/^model-/);

    await harness.backend.prepare(ctx);
    expect(getWorkspaceBinding(ctx, "weknora")?.kbId).toBe(binding?.kbId);
    expect(harness.fake.calls().filter((call) => call === "POST /api/v1/knowledge-bases")).toHaveLength(1);
  });

  it("authenticates every call with the key and the tenant header", async () => {
    await harness.backend.prepare(tenant());
    const headers = harness.fake.lastHeaders();
    expect(headers["x-api-key"]).toBe(loadWeknoraSecrets().apiKey);
    expect(headers["x-tenant-id"]).toBe("1");
  });

  it("registers the desk's embedding model with a real dimension", async () => {
    await harness.backend.prepare(tenant());
    const created = harness.fake.calls().filter((call) => call === "POST /api/v1/models");
    expect(created).toHaveLength(1);
  });
});

describe("weknora ingest and retrieval", () => {
  it("retrieves a planted fact with our own source identity attached", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Planted notes", `The internal code name is ${planted}.`);
    expect(source.status).toBe("Indexed");
    expect(getExternalId(ctx, source.id)).toMatch(/^knowledge-/);

    const result = await retrieveChunks(ctx, planted, 4);
    expect(result.backend).toBe("weknora");
    expect(result.mode).toBe("weknora");
    const hit = result.chunks.find((chunk) => chunk.body.includes(planted));
    expect(hit?.sourceId).toBe(source.id);
    expect(hit?.sourceName).toBe("Planted notes");
    expect(hit?.score).toBeGreaterThan(0);
    expect(hit?.score).toBeLessThanOrEqual(1);
  });

  it("still writes the FTS rows, so the source survives the backend", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Dual written", `The code name is ${planted}.`);
    const rows = sql
      .prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE workspace_id = ? AND source_id = ?")
      .get(ctx.workspaceId, source.id) as { n: number };
    expect(rows.n).toBeGreaterThan(0);
  });

  it("replaces rather than duplicates a source that is indexed twice", async () => {
    const ctx = tenant();
    const planted = token();
    const first = await addPastedSource(ctx, "Notes", `First body with ${planted}.`);
    const firstExternal = getExternalId(ctx, first.id);
    const { indexKnowledgeSource } = await import("../../../knowledge");
    await indexKnowledgeSource(ctx, {
      id: first.id,
      name: "Notes",
      type: "Paste",
      text: `Second body with ${planted}.`,
    });
    const secondExternal = getExternalId(ctx, first.id);
    expect(secondExternal).not.toBe(firstExternal);
    expect(harness.fake.documents().filter((doc) => doc.customMetadata.source_id === first.id)).toHaveLength(1);
  }, 30_000);

  it("stops retrieving a source once it is deleted", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Doomed", `The code name is ${planted}.`);
    expect((await retrieveChunks(ctx, planted, 4)).chunks.length).toBeGreaterThan(0);

    deleteSource(ctx, source.id);
    // The backend delete is fire-and-forget; let it land before asserting the sidecar forgot.
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(harness.fake.documents().filter((doc) => doc.customMetadata.source_id === source.id)).toHaveLength(0);
  });

  it("says which engine answered in the Sources line", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Citable notes", `The code name is ${planted}.`);
    const injected = await knowledgeInjection(ctx, planted);
    expect(injected.backend).toBe("weknora");
    const sources = injected.parts.find((part) => part.label === "Sources");
    expect(sources?.detail).toMatch(/^\d+ chunks · weknora$/);
    expect(injected.prompt).toContain("[1] Citable notes");
  });
});

describe("weknora degraded mode", () => {
  it("falls back to FTS after three failures and says so", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Survivor", `The code name is ${planted}.`);

    harness.fake.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const degraded = await retrieveChunks(ctx, planted, 4);
      expect(degraded.degraded).toBe(true);
      expect(degraded.backend).toBe("builtin");
    }
    expect(knowledgeBackendState().id).toBe("builtin");
    expect(knowledgeBackendState().degraded).toBe(true);

    const injected = await knowledgeInjection(ctx, planted);
    expect(injected.parts.find((part) => part.label === "Sources")?.detail).toMatch(/\(degraded\)$/);
    // The FTS rows written at ingest are what makes the fallback able to answer at all.
    expect(injected.prompt).toContain(planted);
  }, 30_000);

  it("queues the WeKnora half of an ingest while degraded and drains it on recovery", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Before the outage", `The code name is ${planted}.`);

    harness.fake.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await retrieveChunks(ctx, planted, 4);
    }
    const queued = await addPastedSource(ctx, "During the outage", `A second note about ${planted}.`);
    expect(outboxDepth(ctx)).toBeGreaterThan(0);
    expect(pendingOutbox(ctx, 10).some((entry) => entry.sourceId === queued.id)).toBe(true);

    harness.fake.setOffline(false);
    const drained = await drainKnowledgeOutbox(ctx);
    expect(drained).toBeGreaterThan(0);
    expect(getExternalId(ctx, queued.id)).toMatch(/^knowledge-/);
  }, 30_000);

  it("queues a delete the sidecar could not accept", async () => {
    const ctx = tenant();
    const source = await addPastedSource(ctx, "Doomed later", "Body text for the doomed card.");
    const externalId = getExternalId(ctx, source.id);
    expect(externalId).toBeTruthy();

    harness.fake.setOffline(true);
    await harness.backend.deleteSource(ctx, source.id);
    const queued = pendingOutbox(ctx, 10).find((entry) => entry.sourceId === source.id);
    expect(queued?.op).toBe("delete");
    expect(queued?.externalId).toBe(externalId);

    harness.fake.setOffline(false);
    expect(await drainKnowledgeOutbox(ctx)).toBe(1);
    expect(outboxDepth(ctx)).toBe(0);
    expect(getExternalId(ctx, source.id)).toBeNull();
  }, 30_000);

  it("reports health honestly in both directions", async () => {
    await expect(harness.backend.health()).resolves.toMatchObject({ ok: true });
    harness.fake.setOffline(true);
    await expect(harness.backend.health()).resolves.toMatchObject({ ok: false });
  });
});

describe("weknora backfill", () => {
  it("indexes sources the backend has never been given, and is idempotent", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Legacy card", `An older note mentioning ${planted}.`);
    // Simulate a desk that was on the builtin backend when this source was written.
    sql
      .prepare("UPDATE knowledge_sources SET external_id = NULL WHERE workspace_id = ? AND id = ?")
      .run(ctx.workspaceId, source.id);

    expect(await runBackfill(ctx)).toBeGreaterThan(0);
    expect(getExternalId(ctx, source.id)).toMatch(/^knowledge-/);
    // Nothing left to do, so a second run is a no-op rather than a duplicate document.
    expect(await runBackfill(ctx)).toBe(0);
  }, 30_000);
});
