/**
 * Phase 8 — the hosted "Start over", driven through `dispatch` end to end.
 *
 * Written through the router rather than against `resetTenant` directly, because half of what this
 * has to prove is about the route: that `scope: "all"` is still refused on a server, that
 * `scope: "tenant"` is refused on a desk, and that the confirmation and the owner check happen
 * before anything is deleted. A unit test of the function would prove none of that.
 *
 * The shapes it tries to break it with, none of which the happy path names:
 *
 * - a second tenant's rows and objects, present throughout, asserted untouched afterwards;
 * - a member who is not the owner;
 * - the right scope with the wrong word, and the right word with the wrong scope;
 * - a reset run twice, because the storage half is not atomic and retry is the documented answer;
 * - the tenant's very next request, which is the one that used to 403 with `org_inactive` when the
 *   re-provision step was left out.
 */
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-tenant-reset-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "9a41c7e0b3d85f264819ca70de3b5f8c2741ea96b0d35c8f7a2e64193bd0af57";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;
delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;

import { LOCAL_TENANT_ID, RESET_CONFIRM_WORD } from "@agentforge/core";
import { dispatch } from "./router";
import { createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";
import { mediaRelativePath } from "./media-root";
import { tenantPurgeRoots } from "./tenant-reset";
import { tenantDataDir } from "./tenant-paths";
import {
  forgetTenantJobBytes,
  putTenantObject,
  resetObjectStoreForTests,
  tenantObjectStore,
  tenantStorageReport,
} from "./tenant-storage";
import type { HostJsonResult, HostRequest, HostResult } from "./types";
import type { SessionStore } from "./auth/session-store";

const T0 = Date.UTC(2026, 8, 21, 12, 0, 0);
const ALPHA = { tenantId: "reset-tenant-a", orgId: "reset-org-a", userId: "reset-user-a" };
const BETA = { tenantId: "reset-tenant-b", orgId: "reset-org-b", userId: "reset-user-b" };

let store: SessionStore;
const cookies: Record<string, string> = {};

function json(result: HostResult): HostJsonResult {
  if (result.type !== "json") {
    throw new Error(`expected a json result, got ${result.type}`);
  }
  return result;
}

function body(result: HostResult): Record<string, unknown> {
  return json(result).body as Record<string, unknown>;
}

function errorCode(result: HostResult): string | undefined {
  const payload = body(result).error as { code?: string } | string | undefined;
  return typeof payload === "string" ? payload : payload?.code;
}

async function send(as: "alpha" | "beta", over: Partial<HostRequest>, serverMode = true): Promise<HostResult> {
  return dispatch(
    {
      method: "GET",
      path: "/api/v1/storage/usage",
      query: {},
      params: {},
      headers: { cookie: cookies[as] },
      ...over,
    },
    { serverMode, sessionStore: store, now: () => T0 },
  );
}

function resetBody(scope: string, confirm?: string): Partial<HostRequest> {
  return {
    method: "POST",
    path: "/api/v1/settings/reset",
    body: confirm === undefined ? { scope } : { scope, confirm },
  };
}

/** Rows and bytes for one tenant, so "gone" and "kept" both mean something afterwards. */
async function seed(as: "alpha" | "beta", who: typeof ALPHA): Promise<{ mediaId: string; scratch: string }> {
  const { db, media } = await import("@agentforge/db");
  // The default chat agent is provisioned lazily by the chat route, not by `ensurePortalOwner`, so
  // a thread cannot be created before something has asked for it. This is also the seed that gives
  // the purge an `agents` and an `agent_versions` row to take.
  const chat = await send(as, { method: "GET", path: "/api/v1/chat" });
  expect(json(chat).status).toBeLessThan(400);
  const agentId = ((body(chat).agent as { id?: string } | undefined)?.id ?? "") as string;
  expect(agentId).not.toBe("");
  const created = await send(as, { method: "POST", path: "/api/v1/threads", body: { agentId, title: "t" } });
  expect(json(created).status).toBeLessThan(400);

  const mediaId = `${who.tenantId}-media`;
  const key = mediaRelativePath(who.tenantId, [who.orgId], `${mediaId}.bin`);
  await putTenantObject(who.tenantId, key, new Uint8Array(512).fill(4), "application/octet-stream");
  await db.insert(media).values({
    id: mediaId,
    organizationId: who.orgId,
    userId: who.userId,
    kind: "image",
    mime: "application/octet-stream",
    sizeBytes: 512,
    storagePath: key,
    url: `/api/v1/media/${mediaId}/file`,
  });

  // A job tree on local disk: the bytes the object store does not hold.
  const scratch = join(tenantDataDir(who.tenantId), "edit", "scratch.bin");
  mkdirSync(join(tenantDataDir(who.tenantId), "edit"), { recursive: true });
  writeFileSync(scratch, Buffer.alloc(128, 7));
  forgetTenantJobBytes(who.tenantId);
  return { mediaId, scratch };
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { db } = await import("@agentforge/db");
  const row = db.$client.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`).get(value) as { n: number };
  return row.n;
}

async function audits(tenantId: string): Promise<Array<{ outcome: string; rows_deleted: number }>> {
  const { db } = await import("@agentforge/db");
  return db.$client
    .prepare("SELECT outcome, rows_deleted FROM tenant_reset_audit WHERE tenant_id = ? ORDER BY started_at")
    .all(tenantId) as Array<{ outcome: string; rows_deleted: number }>;
}

describe("POST /api/v1/settings/reset with scope tenant", () => {
  beforeAll(async () => {
    const { db, ensurePortalOwner } = await import("@agentforge/db");
    store = createMemorySessionStore();
    for (const [as, who] of [
      ["alpha", ALPHA],
      ["beta", BETA],
    ] as const) {
      await ensurePortalOwner(db, who);
      const session = createSession({ ...who, now: T0 });
      await store.create(session);
      cookies[as] = `__Host-agentforge_session=${session.id}`;
    }
  });

  beforeEach(async () => {
    process.env.AGENTFORGE_SERVER = "1";
    const { db, ensurePortalOwner } = await import("@agentforge/db");
    db.$client.prepare("DELETE FROM tenant_reset_audit").run();
    db.$client.prepare("DELETE FROM tenant_storage").run();
    db.$client.prepare("DELETE FROM media").run();
    rmSync(join(dataDir, "media"), { recursive: true, force: true });
    resetObjectStoreForTests();
    forgetTenantJobBytes();
    // Both tenants exist again after a previous test erased one of them.
    await ensurePortalOwner(db, ALPHA);
    await ensurePortalOwner(db, BETA);
  });

  afterEach(() => {
    delete process.env.AGENTFORGE_SERVER;
    delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("erases the caller's rows, objects and local files", async () => {
    const alpha = await seed("alpha", ALPHA);
    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(1);
    expect(existsSync(alpha.scratch)).toBe(true);

    const result = await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    expect(json(result).status).toBe(200);
    expect(body(result).ok).toBe(true);
    expect(body(result).scope).toBe("tenant");
    // Nothing is staged and nothing restarts: by the time this answers it has already happened.
    expect(body(result).relaunch).toBe(false);
    expect(body(result).resetPending).toBe(false);

    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(0);
    expect(await countRows("threads", "organization_id", ALPHA.orgId)).toBe(0);
    expect(await countRows("tenant_state", "tenant_id", ALPHA.tenantId)).toBe(0);
    expect(await countRows("tenant_storage", "tenant_id", ALPHA.tenantId)).toBe(0);
    expect(existsSync(alpha.scratch)).toBe(false);
    const report = await tenantStorageReport(ALPHA.tenantId);
    expect(report.usedBytes).toBe(0);
  });

  it("leaves every other tenant's rows and bytes exactly as they were", async () => {
    await seed("alpha", ALPHA);
    const beta = await seed("beta", BETA);
    const betaBefore = await tenantStorageReport(BETA.tenantId);

    await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));

    expect(await countRows("media", "organization_id", BETA.orgId)).toBe(1);
    expect(await countRows("threads", "organization_id", BETA.orgId)).toBe(1);
    expect(existsSync(beta.scratch)).toBe(true);
    forgetTenantJobBytes(BETA.tenantId);
    expect((await tenantStorageReport(BETA.tenantId)).usedBytes).toBe(betaBefore.usedBytes);
    // And beta's session still works, which is the whole point of the prefix guard.
    expect(json(await send("beta", {})).status).toBe(200);
  });

  it("leaves the tenant usable: the very next request resolves a clean home desk", async () => {
    await seed("alpha", ALPHA);
    const result = await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    expect(typeof body(result).workspaceId).toBe("string");

    // This is the assertion the re-provision step exists for. Without it the caller's own session
    // resolves to `org_inactive` here, because `resolvePortalTenant` reads and never creates.
    const after = await send("alpha", { method: "GET", path: "/api/v1/threads" });
    expect(json(after).status).toBe(200);
    expect(await countRows("organizations", "tenant_id", ALPHA.tenantId)).toBe(1);
    // A fresh home desk, and nothing on it.
    expect(await countRows("threads", "organization_id", ALPHA.orgId)).toBe(0);
  });

  it("keeps the plan, the seats, the usage ledger and the billing events", async () => {
    const { db } = await import("@agentforge/db");
    const now = Date.now();
    db.$client
      .prepare("INSERT OR REPLACE INTO tenant_plan (tenant_id, period_start, period_end, updated_at) VALUES (?, ?, ?, ?)")
      .run(ALPHA.tenantId, now, now + 1000, now);
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO tenant_usage (id, tenant_id, organization_id, mode, model, unit, quantity, at) VALUES (?, ?, ?, 'chat', 'm', 'token', 1, ?)",
      )
      .run("keep-usage", ALPHA.tenantId, ALPHA.orgId, now);
    db.$client
      .prepare(
        "INSERT OR REPLACE INTO billing_events (event_id, tenant_id, kind, occurred_at, received_at) VALUES (?, ?, 'paid', ?, ?)",
      )
      .run("keep-event", ALPHA.tenantId, now, now);

    await seed("alpha", ALPHA);
    await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));

    expect(await countRows("tenants", "id", ALPHA.tenantId)).toBe(1);
    expect(await countRows("tenant_plan", "tenant_id", ALPHA.tenantId)).toBe(1);
    expect(await countRows("tenant_usage", "tenant_id", ALPHA.tenantId)).toBe(1);
    expect(await countRows("billing_events", "tenant_id", ALPHA.tenantId)).toBe(1);
  });

  it("writes one completed audit row, and keeps it after the purge", async () => {
    await seed("alpha", ALPHA);
    await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    const rows = await audits(ALPHA.tenantId);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.outcome).toBe("completed");
    expect(rows[0]?.rows_deleted).toBeGreaterThan(0);
  });

  it("is safe to run twice: the second pass takes nothing and still answers ok", async () => {
    await seed("alpha", ALPHA);
    const first = await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    expect(json(first).status).toBe(200);
    const second = await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    expect(json(second).status).toBe(200);
    expect(body(second).objectsDeleted).toBe(0);
    const rows = await audits(ALPHA.tenantId);
    expect(rows.map((row) => row.outcome)).toEqual(["completed", "completed"]);
  });

  it("refuses the wrong confirmation word, and deletes nothing", async () => {
    await seed("alpha", ALPHA);
    const result = await send("alpha", resetBody("tenant", "yes"));
    expect(json(result).status).toBe(400);
    expect(errorCode(result)).toBe("invalid_request");
    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(1);
    // Refused before the audit row is opened: nothing happened, so nothing is recorded.
    expect(await audits(ALPHA.tenantId)).toHaveLength(0);
  });

  it("refuses a missing confirmation the same way", async () => {
    await seed("alpha", ALPHA);
    const result = await send("alpha", resetBody("tenant"));
    expect(json(result).status).toBe(400);
    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(1);
  });

  it("refuses a member who is not the owner", async () => {
    const { db } = await import("@agentforge/db");
    await seed("alpha", ALPHA);
    db.$client
      .prepare("UPDATE organization_members SET role = 'member' WHERE organization_id = ? AND user_id = ?")
      .run(ALPHA.orgId, ALPHA.userId);
    const result = await send("alpha", resetBody("tenant", RESET_CONFIRM_WORD));
    expect(json(result).status).toBe(403);
    expect(errorCode(result)).toBe("tenant_reset_forbidden");
    // The refusal is not `gateway_blocked`: that code sends the renderer to the paste-your-key
    // screen, which has nothing to do with being refused an erase.
    expect(errorCode(result)).not.toBe("gateway_blocked");
    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(1);
    expect(await audits(ALPHA.tenantId)).toHaveLength(0);
    db.$client
      .prepare("UPDATE organization_members SET role = 'owner' WHERE organization_id = ? AND user_id = ?")
      .run(ALPHA.orgId, ALPHA.userId);
  });

  it("still refuses scope all on a server, with the code it has always used", async () => {
    await seed("alpha", ALPHA);
    const result = await send("alpha", resetBody("all", RESET_CONFIRM_WORD));
    expect(json(result).status).toBe(403);
    expect(errorCode(result)).toBe("reset_disabled");
    expect(await countRows("media", "organization_id", ALPHA.orgId)).toBe(1);
  });

  it("names the three scopes it accepts when it is handed a fourth", async () => {
    const result = await send("alpha", resetBody("everything", RESET_CONFIRM_WORD));
    expect(json(result).status).toBe(400);
    const message = (body(result).error as { message?: string }).message ?? "";
    expect(message).toContain("tenant");
    expect(message).toContain("all");
  });
});

describe("scope tenant off the hosted server", () => {
  beforeEach(() => {
    delete process.env.AGENTFORGE_SERVER;
  });

  it("is refused on a desk, where Start over is the one that works", async () => {
    const result = await dispatch(
      { method: "POST", path: "/api/v1/settings/reset", query: {}, params: {}, headers: {}, body: { scope: "tenant", confirm: RESET_CONFIRM_WORD } },
      { serverMode: false },
    );
    expect(json(result).status).toBe(403);
    expect(errorCode(result)).toBe("tenant_reset_disabled");
  });
});

describe("the local tenant can never be purged as a tenant", () => {
  it("refuses a whole-prefix delete for local-tenant, in the store itself", async () => {
    // Lane D gives the local tenant the bare root, so "everything under its prefix" is every other
    // tenant's objects. The guard is in the store rather than at the route, which is what makes it
    // hold for a mis-resolved id as well as for a bad request.
    await expect(tenantObjectStore().removePrefix(LOCAL_TENANT_ID)).rejects.toMatchObject({
      code: "storage_purge_refused",
    });
  });

  it("scopes every purge root under the data directory", () => {
    for (const root of tenantPurgeRoots(ALPHA.tenantId)) {
      expect(root.startsWith(dataDir)).toBe(true);
      // And each one is inside the tenant's own subtree, never a shared root.
      expect(root).toContain(ALPHA.tenantId);
    }
  });
});
