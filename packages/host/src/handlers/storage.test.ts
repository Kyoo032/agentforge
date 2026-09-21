/**
 * Phase 6 — the storage routes, driven through `dispatch` on a real database.
 *
 * Through `dispatch` rather than by calling the handlers, because the three things that have to be
 * true are not inside a handler: an upload over the ceiling is refused with a `storage_quota_exceeded`
 * 403 (and not the gateway's code), the usage route is readable BY a tenant that is already over
 * its ceiling, and one tenant's media id is a 404 for another tenant even when the row exists.
 *
 * The two-tenant case is the lane's "done when": two tenants upload, land in disjoint trees, and
 * each is reported its own quota.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-storage-route-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "3f8a1c05d97e26b4084fa3c1e5d7290b6c48af13e02d95b7ca6318fd4e7092a5";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;
delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;

import { dispatch } from "../router";
import { createSession } from "../auth/session";
import { createMemorySessionStore } from "../auth/session-store";
import { forgetTenantJobBytes } from "../tenant-storage";
import type { HostJsonResult, HostRequest, HostResult } from "../types";
import type { SessionStore } from "../auth/session-store";

const T0 = Date.UTC(2026, 8, 21, 9, 0, 0);
const ALPHA = { tenantId: "storage-tenant-a", orgId: "storage-org-a", userId: "storage-user-a" };
const BETA = { tenantId: "storage-tenant-b", orgId: "storage-org-b", userId: "storage-user-b" };

let store: SessionStore;
const cookies = new Map<string, string>();

function json(result: HostResult): HostJsonResult {
  if (result.type !== "json") {
    throw new Error(`expected a json result, got ${result.type}`);
  }
  return result;
}

function body(result: HostResult): Record<string, unknown> {
  return json(result).body as Record<string, unknown>;
}

async function send(identity: { tenantId: string }, over: Partial<HostRequest>): Promise<HostResult> {
  const request: HostRequest = {
    method: "GET",
    path: "/api/v1/storage/usage",
    query: {},
    params: {},
    headers: { cookie: cookies.get(identity.tenantId) ?? "" },
    ...over,
  };
  return dispatch(request, { serverMode: true, sessionStore: store, now: () => T0 });
}

/** A PNG upload of `size` bytes, as the multipart parser hands it to the route. */
function upload(identity: { tenantId: string }, size: number): Promise<HostResult> {
  return send(identity, {
    method: "POST",
    path: "/api/v1/media",
    // No CSRF header: the double-submit check lives in `http-adapter.ts`, above `dispatch`, and
    // `tenant-resolution.md` owns proving it. What is on trial here is the storage rule.
    headers: { cookie: cookies.get(identity.tenantId) ?? "" },
    files: [
      {
        field: "file",
        filename: "shot.png",
        mime: "image/png",
        bytes: new Uint8Array(size).fill(1),
      },
    ],
  });
}

beforeAll(async () => {
  const { db, ensurePortalOwner } = await import("@agentforge/db");
  store = createMemorySessionStore();
  for (const identity of [ALPHA, BETA]) {
    await ensurePortalOwner(db, identity);
    const session = createSession({ ...identity, now: T0 });
    await store.create(session);
    cookies.set(identity.tenantId, `__Host-agentforge_session=${session.id}`);
  }
});

beforeEach(async () => {
  process.env.AGENTFORGE_SERVER = "1";
  const { db } = await import("@agentforge/db");
  db.$client.prepare("DELETE FROM tenant_storage").run();
  db.$client.prepare("DELETE FROM media").run();
  rmSync(join(dataDir, "media"), { recursive: true, force: true });
  forgetTenantJobBytes();
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("GET /api/v1/storage/usage", () => {
  it("reports this tenant's bytes, the ceiling and the percentage", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "1000";
    expect(json(await upload(ALPHA, 400)).status).toBe(201);

    const report = body(await send(ALPHA, {}));
    expect(report).toMatchObject({
      usedBytes: 400,
      objectBytes: 400,
      limitBytes: 1000,
      percent: 40,
      remainingBytes: 600,
      warning: null,
      blocked: false,
      backend: "file",
    });
  });

  it("reports each tenant only its own bytes", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "10000";
    await upload(ALPHA, 500);
    await upload(BETA, 900);

    expect(body(await send(ALPHA, {})).usedBytes).toBe(500);
    expect(body(await send(BETA, {})).usedBytes).toBe(900);
  });

  it("is still readable by a tenant that is over its ceiling", async () => {
    // The whole point of the number is to tell somebody who has just been refused what to delete.
    // A route that refuses the blocked is a dead end in the one case it exists for.
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "1000";
    await upload(ALPHA, 900);
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "500";

    const result = await send(ALPHA, {});
    expect(json(result).status).toBe(200);
    expect(body(result)).toMatchObject({ blocked: true, remainingBytes: 0 });
  });

  it("needs a session like every other by-tenant route", async () => {
    const result = await dispatch(
      { method: "GET", path: "/api/v1/storage/usage", query: {}, params: {}, headers: {} },
      { serverMode: true, sessionStore: store, now: () => T0 },
    );
    expect(json(result).status).toBe(401);
  });
});

describe("POST /api/v1/media under a quota", () => {
  it("stores an upload and serves it back", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "10000";
    const created = body(await upload(ALPHA, 128));
    const fetched = await send(ALPHA, {
      path: `/api/v1/media/${created.id}/file`,
      params: { mediaId: String(created.id) },
    });
    expect(fetched.type).toBe("bytes");
  });

  it("refuses an upload over the ceiling with its own code, not the gateway's", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "1000";
    await upload(ALPHA, 900);

    const refused = await upload(ALPHA, 200);
    expect(json(refused).status).toBe(403);
    const error = body(refused).error as { code: string } | undefined;
    const code = error?.code ?? (body(refused).error as string | undefined);
    expect(code).toBe("storage_quota_exceeded");
    // `gateway_blocked` routes the renderer to the paste-your-key onboarding screen, which is a
    // dead end for a hosted tenant whose actual problem is that their prefix is full.
    expect(code).not.toBe("gateway_blocked");
  });

  it("does not charge one tenant for another tenant's upload", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "1000";
    await upload(ALPHA, 900);
    // Beta is nowhere near its own ceiling, and alpha's 900 bytes are none of its business.
    expect(json(await upload(BETA, 900)).status).toBe(201);
  });

  it("keeps one tenant's media out of another's reach even holding the id", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "10000";
    const created = body(await upload(ALPHA, 64));
    const stolen = await send(BETA, {
      path: `/api/v1/media/${created.id}/file`,
      params: { mediaId: String(created.id) },
    });
    expect(json(stolen).status).toBe(404);
  });
});
