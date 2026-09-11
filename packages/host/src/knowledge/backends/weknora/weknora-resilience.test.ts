import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { addPastedSource, retrieveChunks } from "../../../knowledge";
import { saveSettings } from "../../../settings-store";
import { revokeKnowledgeGatewayModel, selectKnowledgeBackend } from "../../backend-api";
import { getExternalId, getWorkspaceBinding } from "../../backend-store";
import { drainKnowledgeOutbox, knowledgeBackendState, RETRIEVE_DEADLINE_MS } from "../../registry";
import { enqueueOutbox, outboxDepth } from "../../outbox";
import { forgetVerifiedBinding } from "./bootstrap";
import { pendingRevocations } from "./revoke";
import type { SidecarHandle } from "./supervisor";
import { stubSidecar } from "./__fixtures__/stub-sidecar";
import { startWeKnoraHarness, type WeKnoraHarness } from "./__fixtures__/harness";

/**
 * What the WeKnora backend does when the sidecar is slow, wrong, or holding something it should
 * not — the cases that are invisible in a happy-path run and are the whole reason the built-in
 * backend is still there underneath.
 */

let harness: WeKnoraHarness;

function tenant(): TenantContext {
  return {
    organizationId: "org-weknora-res",
    workspaceId: `ws-weknora-res-${crypto.randomUUID()}`,
    userId: "user-weknora-res",
    role: "owner",
  };
}

function token(): string {
  return `zorblatt${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

function vectorCount(ctx: TenantContext, sourceId: string): number {
  const row = sql
    .prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE workspace_id = ? AND source_id = ?")
    .get(ctx.workspaceId, sourceId) as { n: number };
  return row.n;
}

beforeEach(async () => {
  harness = await startWeKnoraHarness();
});

afterEach(async () => {
  await harness.teardown();
});

describe("weknora retrieval deadline", () => {
  it("answers from FTS when the sidecar stalls, inside the turn budget", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Stall survivor", `The code name is ${planted}.`);

    // Up, authenticated, and answering nothing: the failure mode every per-step timeout below the
    // registry handles by *waiting*. Chained, those waits are a minute of dead Chat turn.
    harness.fake.setStalled(true);
    const started = Date.now();
    const result = await retrieveChunks(ctx, planted, 4);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(RETRIEVE_DEADLINE_MS + 3_000);
    expect(result.degraded).toBe(true);
    expect(result.backend).toBe("builtin");
    expect(["fts", "rag", "hybrid"]).toContain(result.mode);
    expect(result.chunks.some((chunk) => chunk.body.includes(planted))).toBe(true);
  }, 40_000);

  it("counts a stalled retrieval as a failure, so three of them degrade the desk", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Degrader", `The code name is ${planted}.`);
    harness.fake.setStalled(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await retrieveChunks(ctx, planted, 4);
    }
    expect(knowledgeBackendState().degraded).toBe(true);
  }, 60_000);
});

describe("weknora dual write", () => {
  it("writes the built-in vectors even while the sidecar is perfectly healthy", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Dual vectors", `The code name is ${planted}.`);
    // Delegating instead of dual-writing is what made the fallback FTS-only: the vectors the
    // degraded path needs have to exist *before* the sidecar goes away, not after.
    expect(vectorCount(ctx, source.id)).toBeGreaterThan(0);
    expect(getExternalId(ctx, source.id)).toMatch(/^knowledge-/);
  }, 40_000);

  it("still has a hybrid-capable answer once the sidecar is gone", async () => {
    const ctx = tenant();
    const planted = token();
    await addPastedSource(ctx, "Outage survivor", `The code name is ${planted}.`);

    harness.fake.setOffline(true);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await retrieveChunks(ctx, planted, 4);
    }
    const fallback = await retrieveChunks(ctx, planted, 4);
    expect(fallback.backend).toBe("builtin");
    // `rag` or `hybrid`, never a bare `fts`: the vector half survived because it was written here.
    expect(["rag", "hybrid"]).toContain(fallback.mode);
  }, 60_000);
});

describe("weknora stale handles", () => {
  it("drops external_id when an index is queued, so no hit is attributed to the old document", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Rewritten", `First body with ${planted}.`);
    expect(getExternalId(ctx, source.id)).toMatch(/^knowledge-/);

    harness.fake.setOffline(true);
    const { indexKnowledgeSource } = await import("../../../knowledge");
    await indexKnowledgeSource(ctx, {
      id: source.id,
      name: "Rewritten",
      type: "Paste",
      text: `Second body with ${planted}.`,
    });
    // The document the sidecar still holds says the *first* body. Keeping the handle would let a
    // hit on that text be cited under this card's name.
    expect(getExternalId(ctx, source.id)).toBeNull();
    expect(outboxDepth(ctx)).toBeGreaterThan(0);

    harness.fake.setOffline(false);
    await drainKnowledgeOutbox(ctx);
    expect(getExternalId(ctx, source.id)).toMatch(/^knowledge-/);
  }, 60_000);
});

describe("weknora outbox drains", () => {
  it("writes each queued row exactly once when two drains race", async () => {
    const ctx = tenant();
    const planted = token();
    const source = await addPastedSource(ctx, "Queued twice", `The code name is ${planted}.`);
    sql.prepare("UPDATE knowledge_sources SET external_id = NULL WHERE workspace_id = ? AND id = ?").run(
      ctx.workspaceId,
      source.id,
    );
    // Queued as if the write had never reached the sidecar. What is under test is two drains over
    // one row, not the ingest that queued it.
    enqueueOutbox(ctx, { op: "index", sourceId: source.id, payload: JSON.stringify({ model: "stub" }) });

    const before = harness.fake.documents().filter((doc) => doc.customMetadata.source_id === source.id).length;
    const [first, second] = await Promise.all([drainKnowledgeOutbox(ctx), drainKnowledgeOutbox(ctx)]);
    const after = harness.fake.documents().filter((doc) => doc.customMetadata.source_id === source.id).length;

    // Two drains, one replay: the second joined the first instead of creating a second document
    // that `external_id` could never name again.
    expect(after - before).toBe(1);
    expect(first).toBe(second);
    expect(outboxDepth(ctx)).toBe(0);
  }, 60_000);
});

describe("weknora binding cache", () => {
  it("does not re-verify the knowledge base on every connect", async () => {
    const ctx = tenant();
    await harness.backend.prepare(ctx);
    const gets = () => harness.fake.calls().filter((call) => /^GET \/api\/v1\/knowledge-bases\//.test(call)).length;
    const afterFirst = gets();

    await harness.backend.prepare(ctx);
    await harness.backend.prepare(ctx);
    expect(gets()).toBe(afterFirst);

    // And the cache is a cache, not a promise: dropping it makes the next connect verify again.
    forgetVerifiedBinding(ctx.workspaceId);
    await harness.backend.prepare(ctx);
    expect(gets()).toBe(afterFirst + 1);
  }, 40_000);
});

describe("weknora gateway credentials", () => {
  it("creates a new model row when the gateway key changes", async () => {
    const ctx = tenant();
    // Bootstrapped offline: the model row upstream holds an empty key and can embed nothing.
    saveSettings({ openaiApiKey: "" }, ctx.workspaceId);
    await harness.backend.prepare(ctx);
    const first = getWorkspaceBinding(ctx, "weknora");
    expect(first?.modelId).toMatch(/^model-/);
    expect(first?.gatewayKeyFp).toBeTruthy();

    saveSettings({ openaiApiKey: "sk-now-there-is-a-key" }, ctx.workspaceId);
    forgetVerifiedBinding(ctx.workspaceId);
    await harness.backend.prepare(ctx);

    const second = getWorkspaceBinding(ctx, "weknora");
    expect(second?.modelId).not.toBe(first?.modelId);
    expect(second?.gatewayKeyFp).not.toBe(first?.gatewayKeyFp);
    // The knowledge base is kept: the geometry did not change, only the credentials behind it.
    expect(second?.kbId).toBe(first?.kbId);
    expect(harness.fake.calls().filter((call) => call === "POST /api/v1/models")).toHaveLength(2);
  }, 40_000);

  it("revokes the model row when the desk switches back to the built-in backend", async () => {
    const ctx = tenant();
    await harness.backend.prepare(ctx);
    const modelId = getWorkspaceBinding(ctx, "weknora")?.modelId;
    expect(harness.fake.models().some((model) => model.id === modelId)).toBe(true);

    await selectKnowledgeBackend(ctx, "builtin");

    // The gateway key rode inside that row. Deselecting has to take it back out, not just stop
    // using it: it is encrypted at rest in a database that outlives the setting.
    expect(harness.fake.models().some((model) => model.id === modelId)).toBe(false);
    expect(getWorkspaceBinding(ctx, "weknora")?.modelId ?? null).toBeNull();
    expect(pendingRevocations()).toHaveLength(0);
  }, 40_000);

  it("revokes the model row when the gateway key is saved over", async () => {
    const ctx = tenant();
    saveSettings({ openaiApiKey: "sk-original" }, ctx.workspaceId);
    await harness.backend.prepare(ctx);
    const modelId = getWorkspaceBinding(ctx, "weknora")?.modelId;
    expect(modelId).toBeTruthy();

    // Exactly what the settings save path calls once the new key is on disk.
    saveSettings({ openaiApiKey: "sk-rotated" }, ctx.workspaceId);
    await revokeKnowledgeGatewayModel(ctx);

    expect(harness.fake.models().some((model) => model.id === modelId)).toBe(false);
    expect(getWorkspaceBinding(ctx, "weknora")?.modelId ?? null).toBeNull();
  }, 40_000);

  it("queues the revocation when the sidecar is down, and applies it later", async () => {
    const ctx = tenant();
    await harness.backend.prepare(ctx);
    const modelId = getWorkspaceBinding(ctx, "weknora")?.modelId;

    harness.fake.setOffline(true);
    await revokeKnowledgeGatewayModel(ctx, { force: true });
    // Locally forgotten, remotely still there: the id has to survive somewhere or the key is lost
    // *and* live.
    expect(pendingRevocations()).toContain(modelId);
    expect(harness.fake.models().some((model) => model.id === modelId)).toBe(true);

    harness.fake.setOffline(false);
    await harness.backend.prepare(ctx);
    expect(harness.fake.models().some((model) => model.id === modelId)).toBe(false);
    expect(pendingRevocations()).toHaveLength(0);
  }, 40_000);
});

describe("weknora drain on read", () => {
  it("never starts the sidecar to drain a queue", async () => {
    // A counting handle in place of the supervisor: `GET /api/v1/knowledge` asking for a base URL
    // at all *is* the cold start, because that is the call that spawns the process.
    let asked = 0;
    await harness.teardown();
    harness = await startWeKnoraHarness({
      sidecar: (baseUrl: string): SidecarHandle => {
        const inner = stubSidecar(baseUrl);
        return {
          ...inner,
          baseUrl: async () => {
            asked += 1;
            return inner.baseUrl();
          },
          // Nothing has spawned it: the shared supervisor this process would consult is cold.
          status: () => ({ ...inner.status(), running: false, ready: false }),
        };
      },
    });
    const ctx = tenant();
    enqueueOutbox(ctx, { op: "index", sourceId: "never-indexed", payload: null });
    expect(outboxDepth(ctx)).toBe(1);

    const { dispatch } = await import("../../../router");
    const result = await dispatch({
      method: "GET",
      path: "/api/v1/knowledge",
      query: {},
      params: {},
      headers: {},
      body: undefined,
      workspaceId: ctx.workspaceId,
    });
    expect(result.type).toBe("json");
    // Give a drain that should not have started the turn it would have needed.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(asked).toBe(0);
    expect(outboxDepth(ctx)).toBe(1);
  }, 40_000);
});
