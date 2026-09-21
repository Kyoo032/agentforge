/**
 * Phase 6 — the object store, the key guard and the quota.
 *
 * The lane's "done when" in `docs/internal/web-migration-plan.md` is what this asserts: two
 * tenants' bytes are disjoint, one cannot reach the other's under any spelling of a key, and a
 * per-tenant ceiling is reported and enforced.
 *
 * The COS backend has its own file (`tenant-storage-cos.test.ts`). Everything here is the file
 * backend, the accounting and the rules that sit above both.
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";

const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-tenant-storage-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
delete process.env.AGENTFORGE_SERVER;
delete process.env.AGENTFORGE_STORAGE;
delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;

const storage = await import("./tenant-storage");
const store = await import("./tenant-storage-store");
const { TENANTS_DIR } = await import("./tenant-paths");
const { mediaRoot } = await import("./media-root");

const A = "tenant-alpha";
const B = "tenant-beta";

/** A real `tenant_storage` table, with the tenant rows its foreign key demands. */
function freshDb(): Database.Database {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE tenants (id text PRIMARY KEY NOT NULL);
    CREATE TABLE tenant_storage (
      tenant_id text PRIMARY KEY NOT NULL REFERENCES tenants(id) ON DELETE cascade,
      bytes_used integer DEFAULT 0 NOT NULL,
      object_count integer DEFAULT 0 NOT NULL,
      measured_at integer,
      updated_at integer NOT NULL
    );
  `);
  for (const id of [A, B, LOCAL_TENANT_ID]) {
    sqlite.prepare("INSERT INTO tenants (id) VALUES (?)").run(id);
  }
  return sqlite;
}

let sqlite: Database.Database | null = null;

function serverMode(limitBytes?: number): void {
  process.env.AGENTFORGE_SERVER = "1";
  if (limitBytes !== undefined) {
    process.env.AGENTFORGE_TENANT_STORAGE_BYTES = String(limitBytes);
  }
  sqlite = freshDb();
  store.registerTenantStorageSql(sqlite);
}

function bytes(count: number): Uint8Array {
  return new Uint8Array(count).fill(7);
}

function key(tenantId: string, ...segments: string[]): string {
  return tenantId === LOCAL_TENANT_ID ? segments.join("/") : [TENANTS_DIR, tenantId, ...segments].join("/");
}

beforeEach(() => {
  storage.resetObjectStoreForTests();
});

afterEach(() => {
  delete process.env.AGENTFORGE_SERVER;
  delete process.env.AGENTFORGE_STORAGE;
  delete process.env.AGENTFORGE_TENANT_STORAGE_BYTES;
  store.resetTenantStorageSqlForTests();
  sqlite?.close();
  sqlite = null;
  // Every root a tenant's bytes can land in, so one case's job tree is not the next case's
  // surprise quota.
  for (const root of [
    mediaRoot(),
    path.join(dataDir, TENANTS_DIR),
    path.join(dataDir, "datasets"),
    path.join(dataDir, "edit"),
  ]) {
    rmSync(root, { recursive: true, force: true });
  }
  storage.forgetTenantJobBytes();
});

afterAll(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

describe("a key belongs to exactly one tenant", () => {
  it("accepts a tenant's own prefix and refuses a bare one", () => {
    expect(storage.assertObjectKey(A, `${TENANTS_DIR}/${A}/org-1/file.png`)).toBe(`${TENANTS_DIR}/${A}/org-1/file.png`);
    expect(() => storage.assertObjectKey(A, "org-1/file.png")).toThrow(ApiError);
  });

  it("refuses the neighbour's prefix, and a prefix that merely starts the same way", () => {
    expect(storage.isObjectKeyInsideTenant(A, `${TENANTS_DIR}/${B}/org-1/file.png`)).toBe(false);
    // `tenant-alpha-2` shares every character of `tenant-alpha` and is a different tenant. A
    // `startsWith` test on the string would pass this, which is why the check is per segment.
    expect(storage.isObjectKeyInsideTenant(A, `${TENANTS_DIR}/tenant-alpha-2/org/file.png`)).toBe(false);
  });

  it("refuses every spelling that walks out of the prefix", () => {
    for (const bad of [
      `${TENANTS_DIR}/${A}/../${B}/file.png`,
      `${TENANTS_DIR}/${A}/./file.png`,
      `${TENANTS_DIR}/${A}//file.png`,
      `/${TENANTS_DIR}/${A}/file.png`,
      `${TENANTS_DIR}\\${A}\\file.png`,
      `C:/${TENANTS_DIR}/${A}/file.png`,
      `${TENANTS_DIR}/${A}/file\u0000.png`,
      "",
      `${TENANTS_DIR}/${A}`,
    ]) {
      expect(storage.isObjectKeyInsideTenant(A, bad)).toBe(false);
    }
  });

  it("lets the local tenant keep the bare root but never reach `tenants/`", () => {
    // Lane D's one exception, as a string test: the local tenant's root IS the install root, so
    // every other tenant's subtree sits inside it.
    expect(storage.isObjectKeyInsideTenant(LOCAL_TENANT_ID, "org-1/file.png")).toBe(true);
    expect(storage.isObjectKeyInsideTenant(LOCAL_TENANT_ID, `${TENANTS_DIR}/${A}/org-1/file.png`)).toBe(false);
    expect(storage.isObjectKeyInsideTenant(LOCAL_TENANT_ID, `${TENANTS_DIR}/anything`)).toBe(false);
  });

  it("refuses a key longer than the cap", () => {
    expect(storage.isObjectKeyInsideTenant(A, `${TENANTS_DIR}/${A}/${"x".repeat(600)}.png`)).toBe(false);
  });

  it("answers 404, not 403, for somebody else's key", () => {
    // A 403 would tell the asker the object exists. The error itself must not be an oracle.
    try {
      storage.assertObjectKey(A, `${TENANTS_DIR}/${B}/file.png`);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("not_found");
      expect((error as ApiError).status).toBe(404);
    }
  });

  it("names the prefix the same way the directory layout does", () => {
    expect(storage.tenantKeyPrefix(A)).toBe(`${TENANTS_DIR}/${A}/`);
    expect(storage.tenantKeyPrefix(LOCAL_TENANT_ID)).toBe("");
  });
});

describe("the file backend", () => {
  it("round-trips an object and reports its size", async () => {
    await storage.putTenantObject(A, key(A, "org-1", "a.bin"), bytes(64), "application/octet-stream");
    expect(await storage.readTenantObject(A, key(A, "org-1", "a.bin"))).toHaveLength(64);
    expect(await storage.tenantObjectStore().head(A, key(A, "org-1", "a.bin"))).toEqual({ sizeBytes: 64 });
  });

  it("puts two tenants in disjoint trees", async () => {
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(10), "application/octet-stream");
    await storage.putTenantObject(B, key(B, "org", "b.bin"), bytes(20), "application/octet-stream");

    expect((await storage.tenantObjectStore().measure(A)).usedBytes).toBe(10);
    expect((await storage.tenantObjectStore().measure(B)).usedBytes).toBe(20);
    // And neither can read the other's, even holding the exact key.
    await expect(storage.readTenantObject(A, key(B, "org", "b.bin"))).rejects.toThrow(ApiError);
  });

  it("does not count another tenant's subtree as the local tenant's", async () => {
    await storage.putTenantObject(LOCAL_TENANT_ID, "org/local.bin", bytes(100), "application/octet-stream");
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(4000), "application/octet-stream");

    // `tenants/` sits inside the local tenant's root. A plain walk would bill the local tenant for
    // everybody else on the box.
    expect(await storage.tenantObjectStore().measure(LOCAL_TENANT_ID)).toEqual({ usedBytes: 100, objectCount: 1 });
  });

  it("refuses a symlink planted inside a tenant's own subtree", async () => {
    const secret = path.join(mediaRoot(), TENANTS_DIR, B, "org");
    mkdirSync(secret, { recursive: true });
    writeFileSync(path.join(secret, "secret.bin"), Buffer.from("beta's bytes"));
    const mine = path.join(mediaRoot(), TENANTS_DIR, A, "org");
    mkdirSync(mine, { recursive: true });
    symlinkSync(path.join(secret, "secret.bin"), path.join(mine, "link.bin"));

    // The key is spelled inside A's prefix and passes the string test; the file backend resolves
    // it and finds it is not A's file. This is the second guard, and it is the one that matters
    // on a filesystem.
    await expect(storage.readTenantObject(A, key(A, "org", "link.bin"))).rejects.toThrow(ApiError);
  });

  it("serves a byte range without reading the whole object", async () => {
    await storage.putTenantObject(A, key(A, "org", "clip.bin"), bytes(1000), "video/mp4");
    const ranged = await storage.readTenantObjectRange(A, key(A, "org", "clip.bin"), "bytes=10-19");
    expect(ranged.status).toBe(206);
    expect(ranged.bytes).toHaveLength(10);
    expect(ranged.headers["Content-Range"]).toBe("bytes 10-19/1000");

    const whole = await storage.readTenantObjectRange(A, key(A, "org", "clip.bin"), undefined);
    expect(whole.status).toBe(200);
    expect(whole.bytes).toHaveLength(1000);

    const past = await storage.readTenantObjectRange(A, key(A, "org", "clip.bin"), "bytes=5000-6000");
    expect(past.status).toBe(416);
  });

  it("hands ffmpeg the object's own path, with nothing copied", async () => {
    await storage.putTenantObject(A, key(A, "org", "v.mp4"), bytes(8), "video/mp4");
    const local = await storage.materializeTenantObject(A, key(A, "org", "v.mp4"));
    expect(local).toBe(path.join(mediaRoot(), key(A, "org", "v.mp4")));
  });
});

describe("the quota", () => {
  it("refuses nothing on a desk, however much is stored", async () => {
    // No server mode, no counter, no database registered at all: a desktop must not be made to
    // open a table to save an image.
    await storage.putTenantObject(LOCAL_TENANT_ID, "org/big.bin", bytes(5000), "application/octet-stream");
    const report = await storage.tenantStorageReport(LOCAL_TENANT_ID);
    expect(report.limitBytes).toBeNull();
    expect(report.blocked).toBe(false);
    expect(report.usedBytes).toBe(5000);
  });

  it("refuses a write that would cross the ceiling, with its own code", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(900), "application/octet-stream");

    const refusal = storage.putTenantObject(A, key(A, "org", "b.bin"), bytes(200), "application/octet-stream");
    await expect(refusal).rejects.toThrow(storage.StorageQuotaError);
    await refusal.catch((error: unknown) => {
      expect((error as ApiError).code).toBe("storage_quota_exceeded");
      expect((error as ApiError).status).toBe(403);
      // Not the gateway's code: that one sends the renderer to the paste-your-key screen, which a
      // hosted tenant whose prefix is full cannot do anything with.
      expect((error as ApiError).code).not.toBe("gateway_blocked");
    });
  });

  it("leaves nothing behind when it refuses", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(900), "application/octet-stream");
    await expect(
      storage.putTenantObject(A, key(A, "org", "b.bin"), bytes(200), "application/octet-stream"),
    ).rejects.toThrow();

    // The check runs before the write, so a refusal never leaves a partial object.
    expect(await storage.tenantObjectStore().head(A, key(A, "org", "b.bin"))).toBeNull();
    expect(store.readTenantStorageCounter(A)?.bytesUsed).toBe(900);
  });

  it("charges one tenant's uploads to that tenant alone", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(900), "application/octet-stream");
    // B has its own ceiling and A's 900 bytes are none of its business.
    await storage.putTenantObject(B, key(B, "org", "b.bin"), bytes(900), "application/octet-stream");
    expect(store.readTenantStorageCounter(A)?.bytesUsed).toBe(900);
    expect(store.readTenantStorageCounter(B)?.bytesUsed).toBe(900);
  });

  it("charges an overwrite the difference, not the whole object again", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(400), "application/octet-stream");
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(600), "application/octet-stream");
    const counter = store.readTenantStorageCounter(A);
    expect(counter?.bytesUsed).toBe(600);
    expect(counter?.objectCount).toBe(1);
  });

  it("gives the bytes back on a delete, and does not give them twice", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(400), "application/octet-stream");
    await storage.removeTenantObject(A, key(A, "org", "a.bin"));
    await storage.removeTenantObject(A, key(A, "org", "a.bin"));
    const counter = store.readTenantStorageCounter(A);
    expect(counter?.bytesUsed).toBe(0);
    expect(counter?.objectCount).toBe(0);
  });

  it("seeds a new counter from a real measure rather than from zero", async () => {
    // The upgrade case: a data volume that already holds this tenant's tree, and a `tenant_storage`
    // table that has never seen them. Starting at zero would hand them a second whole allowance.
    const existing = path.join(mediaRoot(), TENANTS_DIR, A, "org");
    mkdirSync(existing, { recursive: true });
    writeFileSync(path.join(existing, "old.bin"), Buffer.alloc(700));

    serverMode(1000);
    await expect(
      storage.putTenantObject(A, key(A, "org", "new.bin"), bytes(500), "application/octet-stream"),
    ).rejects.toThrow(storage.StorageQuotaError);
    expect(store.readTenantStorageCounter(A)?.bytesUsed).toBe(700);
  });

  it("counts the job trees a tenant keeps on local disk", async () => {
    serverMode(10_000);
    // ffmpeg scratch and dataset files stay on disk under either backend, because the processes
    // that write them take paths. They are the tenant's bytes and the ceiling covers them.
    const scratch = path.join(dataDir, TENANTS_DIR, A, "edit", "project-1");
    mkdirSync(scratch, { recursive: true });
    writeFileSync(path.join(scratch, "export.mp4"), Buffer.alloc(300));
    const datasets = path.join(dataDir, "datasets", TENANTS_DIR, A, "desk-1");
    mkdirSync(datasets, { recursive: true });
    writeFileSync(path.join(datasets, "rows.csv"), Buffer.alloc(200));
    storage.forgetTenantJobBytes();

    const report = await storage.tenantStorageReport(A);
    expect(report.jobBytes).toBe(500);
    expect(report.usedBytes).toBe(500);
  });

  it("does not bill the local tenant for another tenant's dataset files", async () => {
    serverMode(10_000);
    const mine = path.join(dataDir, "datasets", "desk-1");
    mkdirSync(mine, { recursive: true });
    writeFileSync(path.join(mine, "mine.csv"), Buffer.alloc(50));
    const theirs = path.join(dataDir, "datasets", TENANTS_DIR, A, "desk-2");
    mkdirSync(theirs, { recursive: true });
    writeFileSync(path.join(theirs, "theirs.csv"), Buffer.alloc(900));
    storage.forgetTenantJobBytes();

    // `<dataDir>/datasets` IS the local tenant's dataset root, so everybody else's subtree is
    // inside the directory being walked.
    expect((await storage.tenantStorageReport(LOCAL_TENANT_ID)).jobBytes).toBe(50);
  });

  it("reports the ceiling, the percentage and the warning the UI shows", async () => {
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(850), "application/octet-stream");
    const report = await storage.tenantStorageReport(A);
    expect(report.limitBytes).toBe(1000);
    expect(report.percent).toBe(85);
    expect(report.remainingBytes).toBe(150);
    expect(report.warning).toBe("storage_low");
    expect(report.blocked).toBe(false);
    expect(report.backend).toBe("file");
  });

  it("re-measures a drifted counter without touching the objects", async () => {
    serverMode(10_000);
    await storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(300), "application/octet-stream");
    store.setTenantStorageCounter(A, { bytesUsed: 999_999, objectCount: 42 });

    const measured = await storage.recomputeTenantStorage(A);

    expect(measured).toEqual({ usedBytes: 300, objectCount: 1 });
    expect(store.readTenantStorageCounter(A)?.bytesUsed).toBe(300);
    expect(await storage.readTenantObject(A, key(A, "org", "a.bin"))).toHaveLength(300);
  });

  it("refuses to account at all when no connection was installed", () => {
    // Fail loudly rather than silently stop counting: a quota that stops counting is not a quota.
    process.env.AGENTFORGE_SERVER = "1";
    store.resetTenantStorageSqlForTests();
    expect(() => store.readTenantStorageCounter(A)).toThrow(/tenant_storage_backend_missing|never installed/);
  });
});

describe("two writes at once", () => {
  it("does not let both cross the ceiling between the check and the counter", async () => {
    // Round 1 shipped head -> admit -> put with nothing holding the tenant between them: two
    // 600-byte writes against a 1000-byte ceiling both read 100, both were admitted, and the tenant
    // ended at 1300. The atomic SQL delta kept the counter honest afterwards, which is not the same
    // as having enforced the ceiling. `putTenantObject` now runs a tenant's writes in a chain.
    serverMode(1000);
    await storage.putTenantObject(A, key(A, "org", "seed.bin"), bytes(100), "application/octet-stream");

    const results = await Promise.allSettled([
      storage.putTenantObject(A, key(A, "org", "one.bin"), bytes(600), "application/octet-stream"),
      storage.putTenantObject(A, key(A, "org", "two.bin"), bytes(600), "application/octet-stream"),
    ]);

    const accepted = results.filter((result) => result.status === "fulfilled");
    const refused = results.filter((result) => result.status === "rejected");
    expect(accepted).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(storage.StorageQuotaError);

    const report = await storage.tenantStorageReport(A);
    expect(report.usedBytes).toBe(700);
    expect(report.usedBytes).toBeLessThanOrEqual(1000);
  });

  it("does not make one tenant's write wait behind another tenant's", async () => {
    // The chain is per tenant. A shared lock would turn one 500 MB import into everybody's latency.
    serverMode(100_000);
    const order: string[] = [];
    await Promise.all([
      storage.putTenantObject(A, key(A, "org", "a.bin"), bytes(10), "application/octet-stream").then(() => {
        order.push("a");
      }),
      storage.putTenantObject(B, key(B, "org", "b.bin"), bytes(10), "application/octet-stream").then(() => {
        order.push("b");
      }),
    ]);
    expect(order).toHaveLength(2);
    expect(await storage.tenantStorageReport(A).then((report) => report.usedBytes)).toBe(10);
    expect(await storage.tenantStorageReport(B).then((report) => report.usedBytes)).toBe(10);
  });

  it("keeps serving writes after one of them fails", async () => {
    // A rejected write must not poison the chain every later write waits on.
    serverMode(100_000);
    await expect(storage.putTenantObject(A, "tenants/other/x.bin", bytes(10), "application/octet-stream")).rejects.toThrow();
    await storage.putTenantObject(A, key(A, "org", "after.bin"), bytes(20), "application/octet-stream");
    expect(await storage.tenantStorageReport(A).then((report) => report.usedBytes)).toBe(20);
  });
});

describe("the backend picker", () => {
  it("is the file backend unless the variable says COS", () => {
    expect(storage.tenantObjectStore().kind).toBe("file");
    process.env.AGENTFORGE_SERVER = "1";
    storage.resetObjectStoreForTests();
    // Server mode alone does NOT turn COS on: a hosted box without a bucket is a real deployment,
    // and Phase 6 must not break it on upgrade.
    expect(storage.tenantObjectStore().kind).toBe("file");
  });

  it("refuses rather than falling back when COS is on and unconfigured", () => {
    process.env.AGENTFORGE_STORAGE = "cos";
    delete process.env.COS_MEDIA_BUCKET;
    storage.resetObjectStoreForTests();
    // The failure this whole module exists to prevent: a hosted tenant silently writing to a
    // directory nobody backs up because the bucket was misconfigured.
    expect(() => storage.tenantObjectStore()).toThrow(/COS_MEDIA_BUCKET/);
  });
});
