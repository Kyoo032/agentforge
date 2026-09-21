/**
 * Phase 6, round 2 — every writer of tenant bytes goes through the store, and a materialized object
 * is a path ffmpeg is allowed to open.
 *
 * These are the three shapes the first round of this lane missed. They are written as the *rule*
 * rather than as three one-off cases, because the first round's tests did assert that `saveMedia`
 * went through the store and still let two other writers past: a test that names one writer cannot
 * fail when a fourth is added.
 *
 * 1. `writersSweep` reads the tree and fails on any host source that writes into the media root
 *    directly. That is the one that would have caught `handlers/edit.ts` and `starter-media.ts`.
 * 2. The Edit import route is driven through `dispatch` over its ceiling, under the file backend
 *    and then under a stubbed COS bucket, because "answers 201 then 404s on playback" is only
 *    visible end to end.
 * 3. `materializeTenantObject` under COS is handed straight to `assertExistingInput` with the real
 *    `editAllowlist`. No test called those two together, which is how a cache directory outside the
 *    allowlist shipped.
 */
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const dataDir = mkdtempSync(join(tmpdir(), "agentforge-storage-writers-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.MEDIA_ROOT = join(dataDir, "media");
process.env.AGENTFORGE_RUNTIME = "stub";
process.env.AGENTFORGE_SECRETS_KEY = "3f8a1c05d97e26b4084fa3c1e5d7290b6c48af13e02d95b7ca6318fd4e7092a5";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;
delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;

import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";
import { dispatch } from "./router";
import { createSession } from "./auth/session";
import { createMemorySessionStore } from "./auth/session-store";
import { assertExistingInput, editAllowlist } from "./edit/ffmpeg/paths";
import { mediaRelativePath, mediaRoot } from "./media-root";
import { tenantObjectCacheRoot } from "./tenant-paths";
import {
  forgetTenantJobBytes,
  materializeTenantObject,
  putTenantObject,
  resetObjectStoreForTests,
  setCosObjectStoreForTests,
  tenantJobRoots,
  tenantStorageReport,
} from "./tenant-storage";
import { assertPurgeableTenant, isObjectKeyInsideTenant } from "./tenant-object-keys";
import type { TenantObjectStore } from "./tenant-object-keys";
import type { HostJsonResult, HostRequest, HostResult } from "./types";
import type { SessionStore } from "./auth/session-store";

const T0 = Date.UTC(2026, 8, 21, 10, 0, 0);
const ALPHA = { tenantId: "writers-tenant-a", orgId: "writers-org-a", userId: "writers-user-a" };

let store: SessionStore;
let cookie = "";

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

async function send(over: Partial<HostRequest>): Promise<HostResult> {
  return dispatch(
    { method: "GET", path: "/api/v1/storage/usage", query: {}, params: {}, headers: { cookie }, ...over },
    { serverMode: true, sessionStore: store, now: () => T0 },
  );
}

/* ------------------------------------------------------------------ 1. nobody writes the media root */

describe("every writer of media bytes goes through the object store", () => {
  /**
   * The media root is the file backend's storage. A host source that joins `mediaRoot()` with a
   * path and writes it is writing behind the store: no ceiling, no counter, and under COS the bytes
   * land on a disk the read path never consults.
   *
   * Readers are the allowed case and are listed by name. Anything else has to use
   * `putTenantObject`, which is the sweep's whole point — it names a rule, not a file.
   */
  const ALLOWED = new Set([
    // The file backend itself: this is where the media root is supposed to be written.
    "tenant-storage.ts",
    // One sidecar of generation metadata per tenant (`<tenantMediaRoot>/studio-meta.json`), a few
    // KB, read-modify-written as a whole. It is host metadata rather than tenant content, it keeps
    // its location so a desktop install does not lose the file it has, and the file backend's
    // `measure()` counts it. It is listed as a known exception in the lane record rather than
    // silently swept: under COS it stays on local disk.
    "studio-media-meta.ts",
  ]);

  /**
   * The shape both round-1 offenders had: a path built from the media root, then written a few
   * lines later. A whole-file match would also flag `knowledge.ts`, which joins the media root only
   * to *read* the pre-Phase-6 upload directory and writes somewhere else entirely — so the window
   * is what separates "computes a media path" from "writes through one".
   */
  const MEDIA_ROOT_PATH = /\b(path\.)?join\(\s*(mediaRoot\(\)|tenantMediaRoot\()/;
  const WRITES = /\b(writeFile|writeFileSync|createWriteStream|copyFile|copyFileSync|rename|renameSync)\s*\(/;
  const WINDOW = 6;

  /** True when a write follows a media-root path within `WINDOW` lines. */
  function writesThroughMediaRoot(text: string): boolean {
    const lines = text.split("\n");
    return lines.some((line, index) => {
      if (!MEDIA_ROOT_PATH.test(line)) {
        return false;
      }
      return lines.slice(index, index + WINDOW + 1).some((near) => WRITES.test(near));
    });
  }

  function sources(dir: string, found: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        sources(full, found);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        found.push(full);
      }
    }
    return found;
  }

  it("no host source writes into the media root directly", () => {
    const offenders: string[] = [];
    for (const file of sources(join(import.meta.dirname))) {
      const name = path.basename(file);
      if (ALLOWED.has(name)) {
        continue;
      }
      if (writesThroughMediaRoot(readFileSync(file, "utf8"))) {
        offenders.push(path.relative(import.meta.dirname, file));
      }
    }
    // `handlers/edit.ts` and `edit/starter-media.ts` were both here before round 2.
    expect(offenders).toEqual([]);
  });
});

/* ----------------------------------------------------------------------- 2. the Edit import route */

describe("POST /api/v1/edit/projects/:projectId/import", () => {
  beforeAll(async () => {
    const { db, ensurePortalOwner } = await import("@agentforge/db");
    store = createMemorySessionStore();
    await ensurePortalOwner(db, ALPHA);
    const session = createSession({ ...ALPHA, now: T0 });
    await store.create(session);
    cookie = `__Host-agentforge_session=${session.id}`;
  });

  beforeEach(async () => {
    process.env.AGENTFORGE_SERVER = "1";
    const { db } = await import("@agentforge/db");
    db.$client.prepare("DELETE FROM tenant_storage").run();
    db.$client.prepare("DELETE FROM media").run();
    rmSync(join(dataDir, "media"), { recursive: true, force: true });
    resetObjectStoreForTests();
    forgetTenantJobBytes();
  });

  afterEach(() => {
    delete process.env.AGENTFORGE_SERVER;
    delete process.env.AGENTFORGE_STORAGE;
    delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;
    setCosObjectStoreForTests(null);
  });

  afterAll(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  async function newProject(): Promise<string> {
    const created = await send({ method: "POST", path: "/api/v1/edit/projects", body: { title: "p" } });
    const id = (body(created).project as { id: string } | undefined)?.id ?? (body(created).id as string);
    expect(typeof id).toBe("string");
    return id;
  }

  function importOf(projectId: string, size: number): Promise<HostResult> {
    return send({
      method: "POST",
      path: `/api/v1/edit/projects/${projectId}/import`,
      params: { projectId },
      files: [{ field: "file", filename: "clip.png", mime: "image/png", bytes: new Uint8Array(size).fill(7) }],
    });
  }

  it("refuses an import over the ceiling with storage_quota_exceeded, and stores nothing", async () => {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "1000";
    const projectId = await newProject();
    // Fill most of the allowance through the media route, which was already metered.
    await send({
      method: "POST",
      path: "/api/v1/media",
      files: [{ field: "file", filename: "a.png", mime: "image/png", bytes: new Uint8Array(900).fill(1) }],
    });

    const refused = await importOf(projectId, 500);
    expect(json(refused).status).toBe(403);
    expect(errorCode(refused)).toBe("storage_quota_exceeded");
    // Not the gateway's code: that one sends a hosted tenant to the paste-your-key screen.
    expect(errorCode(refused)).not.toBe("gateway_blocked");

    const report = await tenantStorageReport(ALPHA.tenantId);
    expect(report.usedBytes).toBe(900);
  });

  it("gives the bytes back when the probe rejects the file", async () => {
    // There is no ffmpeg in this container, so every import fails its probe here — which makes this
    // the refund path, and the refund is only possible if the write went through the store in the
    // first place. A route that wrote the disk directly could neither charge nor refund.
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = "100000";
    const projectId = await newProject();
    const before = Number(body(await send({})).usedBytes);

    const rejected = await importOf(projectId, 4096);
    expect(json(rejected).status).toBe(400);
    expect(errorCode(rejected)).toBe("unsupported_media");

    const after = Number(body(await send({})).usedBytes);
    expect(after).toBe(before);
    // And no orphan object was left behind under the tenant's prefix.
    const report = await tenantStorageReport(ALPHA.tenantId);
    expect(report.objectBytes).toBe(before);
  });
});

/* ------------------------------------------------------- 3. a COS-backed asset is readable and probable */

describe("under the COS backend", () => {
  /** An in-memory stand-in for the bucket. Only what the store actually calls. */
  function memoryCosStore(): TenantObjectStore & { keys: () => string[] } {
    const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const require = (key: string): { bytes: Uint8Array; contentType: string } => {
      const found = objects.get(key);
      if (!found) {
        throw new ApiError("not_found", "No such object", 404);
      }
      return found;
    };
    return {
      kind: "cos",
      keys: () => [...objects.keys()],
      async put(_tenantId, key, bytes, contentType) {
        objects.set(key, { bytes: new Uint8Array(bytes), contentType });
      },
      async read(_tenantId, key) {
        return require(key).bytes;
      },
      async readRange(_tenantId, key) {
        const found = require(key);
        return { kind: "whole", bytes: found.bytes, contentType: found.contentType } as never;
      },
      async head(_tenantId, key) {
        const found = objects.get(key);
        return found ? { sizeBytes: found.bytes.byteLength, contentType: found.contentType } : null;
      },
      async remove(_tenantId, key) {
        objects.delete(key);
      },
      async measure() {
        let usedBytes = 0;
        for (const value of objects.values()) {
          usedBytes += value.bytes.byteLength;
        }
        return { usedBytes, objectCount: objects.size };
      },
      // Phase 8: the stub bucket's whole-prefix delete. Only this tenant's keys, so a test that
      // purges one tenant can still assert another tenant's objects are untouched.
      async removePrefix(tenantId) {
        assertPurgeableTenant(tenantId);
        let usedBytes = 0;
        let objectCount = 0;
        for (const key of [...objects.keys()]) {
          if (!isObjectKeyInsideTenant(tenantId, key)) {
            continue;
          }
          usedBytes += objects.get(key)?.bytes.byteLength ?? 0;
          objectCount += 1;
          objects.delete(key);
        }
        return { usedBytes, objectCount };
      },
      describe(_tenantId, key) {
        return `cos://stub/${key}`;
      },
    } as TenantObjectStore & { keys: () => string[] };
  }

  beforeEach(() => {
    process.env.AGENTFORGE_STORAGE = "cos";
    resetObjectStoreForTests();
    forgetTenantJobBytes();
  });

  afterEach(() => {
    delete process.env.AGENTFORGE_STORAGE;
    delete process.env.AGENTFORGE_SERVER;
    setCosObjectStoreForTests(null);
    resetObjectStoreForTests();
  });

  it("hands ffmpeg a materialized path the edit allowlist accepts", async () => {
    // The finding: the cache lives under `<tenantDataDir>/cache/objects/`, and `editAllowlist`
    // listed only the media root and the scratch root, so every probe, frame, render and audio
    // extract on a COS-backed asset died as `path_denied` before ffmpeg was ever invoked.
    const cos = memoryCosStore();
    setCosObjectStoreForTests(cos);
    const tenantId = ALPHA.tenantId;
    const key = mediaRelativePath(tenantId, [ALPHA.orgId], "asset-1.mp4");
    await putTenantObject(tenantId, key, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), "video/mp4");

    const local = await materializeTenantObject(tenantId, key);
    expect(local.startsWith(tenantObjectCacheRoot(tenantId))).toBe(true);
    expect(statSync(local).size).toBe(8);

    const allow = editAllowlist({ tenantId, projectId: "proj-1" });
    expect(() => assertExistingInput(local, allow)).not.toThrow();
  });

  it("still refuses another tenant's materialized cache", async () => {
    // The new root must not become a way around the tenant boundary. The local tenant's data dir
    // contains everyone else's, so its allowlist is the one that has to hold.
    const cos = memoryCosStore();
    setCosObjectStoreForTests(cos);
    const key = mediaRelativePath(ALPHA.tenantId, [ALPHA.orgId], "asset-2.mp4");
    await putTenantObject(ALPHA.tenantId, key, new Uint8Array([9, 9, 9, 9]), "video/mp4");
    const foreign = await materializeTenantObject(ALPHA.tenantId, key);

    const allow = editAllowlist({ tenantId: LOCAL_TENANT_ID, projectId: "proj-1" });
    expect(() => assertExistingInput(foreign, allow)).toThrow(/another tenant/);
  });

  it("puts an Edit import in the bucket, not on the disk", async () => {
    const cos = memoryCosStore();
    setCosObjectStoreForTests(cos);
    const tenantId = ALPHA.tenantId;
    const key = mediaRelativePath(tenantId, [ALPHA.orgId], "import-1.png");
    await putTenantObject(tenantId, key, new Uint8Array(64).fill(3), "image/png");

    expect(cos.keys()).toContain(key);
    // Nothing under the media root: that was the shape where an import answered 201 and the media
    // route then asked the bucket for a key that had never reached it.
    expect(() => statSync(join(mediaRoot(), key))).toThrow();
  });
});

/* ------------------------------------------------------------------ 4. the job roots cover the modes */

describe("tenantJobRoots", () => {
  it("counts meeting recordings, legal files and knowledge uploads", () => {
    const roots = tenantJobRoots(ALPHA.tenantId).map((entry) => entry.root);
    // Named individually because each one is a route through which a tenant can fill a disk, and a
    // count assertion would pass when a later change swaps one for another.
    for (const segment of ["edit", "knowledge", "datasets", "meetings", "legal"]) {
      expect(roots.some((root) => root.includes(segment))).toBe(true);
    }
  });

  it("measures bytes a mode wrote outside the media root", async () => {
    delete process.env.AGENTFORGE_SERVER;
    resetObjectStoreForTests();
    forgetTenantJobBytes();
    const tenantId = "writers-tenant-jobs";
    const meeting = join(dataDir, "meetings", "tenants", tenantId, "ws-1", "m-1", "recording");
    await mkdir(meeting, { recursive: true });
    await writeFile(join(meeting, "source.m4a"), new Uint8Array(2048).fill(5));

    const report = await tenantStorageReport(tenantId);
    // Before round 2 this was 0: a tenant could fill the disk through Meeting with the quota
    // reporting nothing at all.
    expect(report.jobBytes).toBe(2048);
    expect(report.usedBytes).toBeGreaterThanOrEqual(2048);
  });
});
