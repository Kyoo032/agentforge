import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { findSourceByOrigin, listSources } from "./knowledge";
import { SELF_CHECK_ORIGIN, getKnowledgeVerify, runKnowledgeSelfCheck } from "./knowledge-verify";
import {
  SELF_CHECK_MIN_INTERVAL_MS,
  handlePostKnowledgeVerify,
  throttledSelfCheck,
} from "./handlers/knowledge";
import { getTenant } from "./tenant";
import type { HostRequest } from "./types";

/**
 * The Verified stage: plant a fact, retrieve it, delete it, and write down what happened. It runs
 * against the live workspace, so leaving anything behind — a source, a chunk, a vector — is a bug.
 */

function tenant(): TenantContext {
  return {
    tenantId: "local-tenant",
    organizationId: "org-verify",
    workspaceId: `ws-verify-${crypto.randomUUID()}`,
    userId: "user-verify",
    role: "owner",
  };
}

describe("knowledge self-check", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-verify-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("retrieves its own planted token and reports how", async () => {
    const ctx = tenant();
    const record = await runKnowledgeSelfCheck(ctx);
    expect(record.ok).toBe(true);
    expect(record.detail).toMatch(/^retrieved in \d+ ms · mode (rag|fts|hybrid)$/);
    expect(record.at).toBeGreaterThan(0);
  });

  it("leaves no source, chunk or vector behind", async () => {
    const ctx = tenant();
    await runKnowledgeSelfCheck(ctx);
    expect(listSources(ctx)).toHaveLength(0);
    expect(findSourceByOrigin(ctx, SELF_CHECK_ORIGIN)).toBe(null);
    const chunks = sql
      .prepare("SELECT count(*) AS n FROM knowledge_chunks WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { n: number };
    expect(chunks.n).toBe(0);
    const vectors = sql
      .prepare("SELECT count(*) AS n FROM knowledge_vectors WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { n: number };
    expect(vectors.n).toBe(0);
  });

  it("keeps exactly one record per workspace across runs", async () => {
    const ctx = tenant();
    await runKnowledgeSelfCheck(ctx);
    const second = await runKnowledgeSelfCheck(ctx);
    const rows = sql
      .prepare("SELECT count(*) AS n FROM knowledge_verify WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { n: number };
    expect(rows.n).toBe(1);
    expect(getKnowledgeVerify(ctx)).toEqual(second);
  });

  it("runs one check at a time per workspace, and both callers get that run", async () => {
    const ctx = tenant();
    // Two checks of one workspace share the same fixed origin: run them at once and one run's
    // cleanup deletes the other's plant, so the loser reports a knowledge base that cannot answer.
    const [first, second] = await Promise.all([runKnowledgeSelfCheck(ctx), runKnowledgeSelfCheck(ctx)]);
    expect(second).toBe(first);
    expect(first.ok).toBe(true);
    expect(findSourceByOrigin(ctx, SELF_CHECK_ORIGIN)).toBe(null);
    const rows = sql
      .prepare("SELECT count(*) AS n FROM knowledge_verify WHERE workspace_id = ?")
      .get(ctx.workspaceId) as { n: number };
    expect(rows.n).toBe(1);

    // The gate is per workspace: a different one is never made to wait for this run.
    const other = await runKnowledgeSelfCheck(tenant());
    expect(other.ok).toBe(true);
    // And it opens again once the run settles, so a later check is a real check.
    const later = await runKnowledgeSelfCheck(ctx);
    expect(later).not.toBe(first);
    expect(later.ok).toBe(true);
  });

  it("reports null before the first run", () => {
    expect(getKnowledgeVerify(tenant())).toBe(null);
  });

  it("records a failure instead of throwing when retrieval cannot answer", async () => {
    const ctx = tenant();
    // A workspace whose FTS table is unusable is the closest stand-in for a broken engine: the
    // check has to come back as a record, never as an exception on the caller's request.
    const record = await runKnowledgeSelfCheck({ ...ctx, workspaceId: "" });
    expect(typeof record.ok).toBe("boolean");
    expect(record.detail.length).toBeGreaterThan(0);
  });
});

describe("self-check throttle", () => {
  let previousRuntime: string | undefined;
  let previousSettings: string | undefined;
  let settingsDir: string;

  beforeEach(() => {
    previousRuntime = process.env.AGENTFORGE_RUNTIME;
    previousSettings = process.env.AGENTFORGE_SETTINGS_PATH;
    settingsDir = mkdtempSync(join(tmpdir(), "af-verify-throttle-"));
    process.env.AGENTFORGE_RUNTIME = "stub";
    process.env.AGENTFORGE_SETTINGS_PATH = settingsDir;
  });

  afterEach(() => {
    restore("AGENTFORGE_RUNTIME", previousRuntime);
    restore("AGENTFORGE_SETTINGS_PATH", previousSettings);
    rmSync(settingsDir, { recursive: true, force: true });
  });

  it("serves the stored record while it is younger than the minimum interval", () => {
    const now = 1_000_000;
    const fresh = { ok: true, at: now - 1_000, detail: "retrieved in 3 ms · mode hybrid" };
    expect(SELF_CHECK_MIN_INTERVAL_MS).toBe(10_000);
    expect(throttledSelfCheck(fresh, now)).toEqual(fresh);
    expect(throttledSelfCheck({ ...fresh, at: now - SELF_CHECK_MIN_INTERVAL_MS }, now)).toBe(null);
    expect(throttledSelfCheck(null, now)).toBe(null);
    // A record stamped in the future (clock moved back) is never treated as fresh.
    expect(throttledSelfCheck({ ...fresh, at: now + 5_000 }, now)).toBe(null);
  });

  it("answers a rapid second POST with the stored record instead of re-running", async () => {
    // The check plants and deletes a real source, so an unthrottled endpoint is a free way for a
    // page (or a stuck button) to churn the live knowledge base.
    const live = await getTenant();
    sql.prepare("DELETE FROM knowledge_verify WHERE workspace_id = ?").run(live.workspaceId);

    const first = await handlePostKnowledgeVerify(request());
    expect(first.type).toBe("json");
    const second = await handlePostKnowledgeVerify(request());
    expect(second.type).toBe("json");
    if (first.type !== "json" || second.type !== "json") {
      return;
    }
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body).toMatchObject({ throttled: false, at: expect.any(Number) });
    expect(second.body).toMatchObject({ throttled: true });
    expect((second.body as { at: number }).at).toBe((first.body as { at: number }).at);
    // The throttled call re-ran nothing, so it cannot have left a plant behind either.
    expect(findSourceByOrigin(live, SELF_CHECK_ORIGIN)).toBe(null);
  });
});

function request(): HostRequest {
  return { method: "POST", path: "/api/v1/knowledge/verify", query: {}, params: {}, headers: {}, body: {} };
}

function restore(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
