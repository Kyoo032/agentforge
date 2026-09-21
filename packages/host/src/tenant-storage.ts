/**
 * Phase 6 — the one interface a tenant's bytes go through, and the quota over it.
 *
 * Phase 3 lane D gave every tenant a disjoint *directory*. That is the right layout and the wrong
 * medium for a hosted box: the disk is the deployment's most fragile part (the runbook's own
 * backup tarball stops being workable as it grows, `docs/internal/tencent-cvm-setup.md` §12), and
 * nothing stopped one tenant filling it for everybody. Phase 6 puts the same layout behind an
 * interface with two backends and a ceiling.
 *
 * **The rule, and there is only one:** the backend is chosen by *mode*, never by tenant.
 * `objectStorageKind()` reads one environment variable — `AGENTFORGE_STORAGE=cos` — and everything
 * else follows. There is no per-tenant branch to get wrong and no fallback from one backend to the
 * other at read time, because a fallback is how a hosted tenant silently ends up reading a
 * directory nobody backs up. That is the same shape Phase 4 gave `tenant-state-store.ts`.
 *
 * **Keys are the on-disk layout, spelled with slashes.** `tenants/<id>/<org>/<uuid>.png` in the
 * bucket is `<mediaRoot>/tenants/<id>/<org>/<uuid>.png` on disk, and the local tenant keeps the
 * bare root in both (lane D's one rule, `tenant-paths.ts`). So a `media.storage_path` written
 * before this phase resolves verbatim under either backend, and switching a deployment to COS is a
 * copy of the tree rather than a rewrite of the database.
 *
 * **Two guards, not one.** `assertObjectKey` is a pure POSIX test that a key belongs to the tenant
 * whose request this is — it runs first, before any IO, so a crafted key never reaches a bucket or
 * a filesystem at all. The file backend then *also* resolves symlinks through
 * `resolveInsideTenantRoot`, because a link planted inside a tenant's subtree passes any lexical
 * test while pointing anywhere on disk. COS has no symlinks, so there the first guard is the whole
 * story.
 *
 * **What the quota counts.** Everything a tenant is holding: the objects in this store, plus the
 * job trees that stay on local disk because the processes that write them need real file paths
 * (ffmpeg's scratch under `<dataDir>/tenants/<id>/edit/`, dataset files under
 * `<dataDir>/datasets/tenants/<id>/`). Objects are counted in `tenant_storage`; the job trees are
 * measured, briefly memoised, and added. One number, and it is the number the refusal uses.
 */
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ApiError,
  isServerMode,
  objectStorageKind,
  storageAdmission,
  storageReport,
  STORAGE_BLOCK,
  STORAGE_BLOCK_MESSAGE,
  tenantStorageLimitBytes,
  type ObjectStorageKind,
  type TenantStorageReport,
  type TenantStorageUse,
} from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { parseByteRange, type RangedBytes } from "./byte-range";
import { createCosObjectStore } from "./tenant-storage-cos";
import { log } from "./log";
import { mediaRoot } from "./media-root";
import { assertObjectKey, objectNotFound, type TenantObjectStore } from "./tenant-object-keys";
import {
  assertTenantId,
  isLocalTenant,
  resolveInsideTenantRoot,
  tenantDataDir,
  tenantObjectCacheRoot,
  tenantScopedRoot,
  TENANTS_DIR,
} from "./tenant-paths";
import {
  addTenantStorageBytes,
  readTenantStorageCounter,
  setTenantStorageCounter,
  type TenantStorageCounter,
} from "./tenant-storage-store";

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function rangeHeaders(bytes: Uint8Array, range: { start: number; end: number } | null, size: number): RangedBytes {
  if (!range) {
    return { status: 200, bytes, headers: { "Accept-Ranges": "bytes", "Content-Length": String(size) } };
  }
  return {
    status: 206,
    bytes,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": String(bytes.byteLength),
    },
  };
}

function unsatisfiable(size: number): RangedBytes {
  return {
    status: 416,
    bytes: new Uint8Array(0),
    headers: { "Accept-Ranges": "bytes", "Content-Range": `bytes */${size}` },
  };
}

/* -------------------------------------------------------------------- the file backend (disk) */

/**
 * Re-exported so a call site needs one import rather than two. The definitions live in
 * `tenant-object-keys.ts` because the COS backend checks a key and would otherwise close a cycle.
 */
export {
  assertObjectKey,
  isObjectKeyInsideTenant,
  tenantKeyPrefix,
  objectNotFound,
  type ObjectHead,
  type TenantObjectStore,
} from "./tenant-object-keys";

/** The absolute path a key names, with symlinks resolved, or a 404 when it is not this tenant's. */
function objectPath(tenantId: string, key: string): string {
  const root = mediaRoot();
  const real = resolveInsideTenantRoot(root, tenantId, path.resolve(root, assertObjectKey(tenantId, key)));
  if (real === null) {
    objectNotFound();
  }
  return real;
}

/** Bytes and files under `dir`, skipping anything in `denied`. Symlinks are never followed. */
async function walkBytes(dir: string, denied: readonly string[]): Promise<TenantStorageUse> {
  let usedBytes = 0;
  let objectCount = 0;
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return { usedBytes: 0, objectCount: 0 };
    }
    throw error;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (denied.some((other) => full === other || full.startsWith(`${other}${path.sep}`))) {
      continue;
    }
    if (entry.isDirectory()) {
      const nested = await walkBytes(full, denied);
      usedBytes += nested.usedBytes;
      objectCount += nested.objectCount;
      continue;
    }
    if (!entry.isFile()) {
      // A symlink is counted as nothing: its target is either inside this tenant's tree and
      // counted where it really lives, or outside it and not this tenant's to be charged for.
      continue;
    }
    try {
      usedBytes += (await stat(full)).size;
      objectCount += 1;
    } catch (error) {
      if (!isMissing(error)) {
        throw error;
      }
    }
  }
  return { usedBytes, objectCount };
}

/** Sub-trees inside a tenant's own root that belong to somebody else. Only the local tenant has any. */
function deniedUnder(root: string, tenantId: string): string[] {
  return isLocalTenant(tenantId) ? [path.join(root, TENANTS_DIR)] : [];
}

export const fileObjectStore: TenantObjectStore = {
  kind: "file",

  async put(tenantId, key, bytes, _contentType) {
    const full = objectPath(tenantId, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
  },

  async read(tenantId, key) {
    try {
      return await readFile(objectPath(tenantId, key));
    } catch (error) {
      if (isMissing(error)) {
        objectNotFound();
      }
      throw error;
    }
  },

  async readRange(tenantId, key, rangeHeader) {
    const full = objectPath(tenantId, key);
    let size: number;
    try {
      size = (await stat(full)).size;
    } catch (error) {
      if (isMissing(error)) {
        objectNotFound();
      }
      throw error;
    }
    const range = parseByteRange(rangeHeader, size);
    if (range === "unsatisfiable") {
      return unsatisfiable(size);
    }
    // Only the requested bytes are read, so scrubbing a long clip does not re-read the whole file
    // per seek. This is `readByteRange`'s behaviour, kept, rather than a whole-file read sliced.
    const start = range ? range.start : 0;
    const end = range ? range.end : Math.max(0, size - 1);
    const length = size === 0 ? 0 : end - start + 1;
    const chunks: Buffer[] = [];
    if (length > 0) {
      await new Promise<void>((resolve, reject) => {
        const stream = createReadStream(full, { start, end });
        stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on("error", reject);
        stream.on("end", () => resolve());
      });
    }
    return rangeHeaders(new Uint8Array(Buffer.concat(chunks)), range, size);
  },

  async head(tenantId, key) {
    try {
      return { sizeBytes: (await stat(objectPath(tenantId, key))).size };
    } catch (error) {
      if (isMissing(error)) {
        return null;
      }
      throw error;
    }
  },

  async remove(tenantId, key) {
    await rm(objectPath(tenantId, key), { force: true });
  },

  async measure(tenantId) {
    const root = mediaRoot();
    return walkBytes(tenantScopedRoot(root, tenantId), deniedUnder(root, tenantId));
  },

  describe(tenantId, key) {
    return path.join(mediaRoot(), assertObjectKey(tenantId, key));
  },
};

/* ------------------------------------------------------------------------------- the picker */

let cosStore: TenantObjectStore | null = null;

/** Test seam: drop the memoised COS client so a suite can re-read the environment. */
export function resetObjectStoreForTests(): void {
  cosStore = null;
  jobBytesCache.clear();
}

/**
 * Test seam: use this COS store instead of building one from the environment.
 *
 * It exists so a suite can drive the **routes** over a stubbed bucket — `createCosObjectStore`
 * takes a `fetchImpl`, but nothing between a request and the store could pass one in, which is why
 * no test in the first round of this lane ran a handler under the COS backend. `AGENTFORGE_STORAGE`
 * still has to say `cos`, so this cannot silently swap the backend out from under a real process.
 */
export function setCosObjectStoreForTests(store: TenantObjectStore | null): void {
  cosStore = store;
  jobBytesCache.clear();
}

/**
 * The store this process uses, resolved per call rather than once at import: the suites and
 * `apps/web` both set environment after the module graph is loaded, and a store frozen at import
 * time would answer for the mode the process started in.
 */
export function tenantObjectStore(): TenantObjectStore {
  if (objectStorageKind() !== "cos") {
    return fileObjectStore;
  }
  if (!cosStore) {
    // Built on first use, not at import: `createCosObjectStore` reads the environment and THROWS
    // when the bucket or the credentials are not configured, rather than handing back the file
    // store. A silent fall back to a directory nobody backs up is the failure this module exists
    // to prevent, and a desk that never asks for COS never pays for the check.
    cosStore = createCosObjectStore();
  }
  return cosStore;
}

/* --------------------------------------------------------------- the job trees on local disk */

/**
 * The roots a tenant's *job* bytes live in, which stay on local disk under either backend because
 * the processes that write them need real file paths: ffmpeg's scratch and the dataset files the
 * in-memory SQLite runner reads. They are already disjoint per tenant (lane D); Phase 6 counts
 * them.
 */
export type TenantJobRoot = {
  /** The directory to walk. */
  readonly root: string;
  /** Sub-trees inside it that belong to another tenant — only ever non-empty for the local tenant. */
  readonly denied: readonly string[];
};

export function tenantJobRoots(tenantId: string): TenantJobRoot[] {
  const dataDir = localDataDir();
  const datasets = path.resolve(dataDir, "datasets");
  const meetings = path.resolve(dataDir, "meetings");
  const legal = path.resolve(dataDir, "legal");
  return [
    // ffmpeg scratch. `tenantDataDir` has already applied the prefix, and a project id spelled
    // `tenants` is refused by `assertPathSegment`, so nothing of anyone else's can be under it.
    { root: path.join(tenantDataDir(tenantId), "edit"), denied: [] },
    // Knowledge uploads. Same shape as the scratch root: already under the tenant's data directory,
    // so no other tenant's tree is inside it. See `knowledge.ts` for why these bytes stay on disk
    // under both backends — three readers find them by a readdir prefix scan, not by key.
    { root: path.join(tenantDataDir(tenantId), "knowledge"), denied: [] },
    // Dataset files. For the local tenant the scoped root IS `<dataDir>/datasets`, so every other
    // tenant's dataset subtree sits inside the directory being walked and has to be skipped.
    { root: tenantScopedRoot(datasets, tenantId), denied: deniedUnder(datasets, tenantId) },
    // Meeting recordings. 25 MB each and unbounded in number, so leaving them out was the one gap
    // through which a tenant could fill the disk with the quota reading 0%.
    { root: tenantScopedRoot(meetings, tenantId), denied: deniedUnder(meetings, tenantId) },
    // Legal matter files: a per-matter cap, but no cap on matters.
    { root: tenantScopedRoot(legal, tenantId), denied: deniedUnder(legal, tenantId) },
  ];
}

type CachedJobBytes = { at: number; use: TenantStorageUse };

const jobBytesCache = new Map<string, CachedJobBytes>();

/**
 * How long a job-tree measure is reused. The walk is bounded by one tenant's own scratch tree, but
 * it is still a walk, and an upload burst would otherwise do it once per file. Ten seconds is short
 * enough that a tenant cannot outrun the ceiling by more than one burst and long enough that a
 * burst pays for the walk once.
 */
const JOB_BYTES_TTL_MS = 10_000;

export async function measureTenantJobBytes(tenantId: string, nowMs = Date.now()): Promise<TenantStorageUse> {
  const cached = jobBytesCache.get(tenantId);
  if (cached && nowMs - cached.at < JOB_BYTES_TTL_MS) {
    return cached.use;
  }
  let usedBytes = 0;
  let objectCount = 0;
  for (const { root, denied } of tenantJobRoots(tenantId)) {
    const nested = await walkBytes(root, denied);
    usedBytes += nested.usedBytes;
    objectCount += nested.objectCount;
  }
  const use = { usedBytes, objectCount };
  jobBytesCache.set(tenantId, { at: nowMs, use });
  return use;
}

/** Forget a tenant's memoised job measure, so the next read walks again. */
export function forgetTenantJobBytes(tenantId?: string): void {
  if (tenantId === undefined) {
    jobBytesCache.clear();
    return;
  }
  jobBytesCache.delete(tenantId);
}

/* ------------------------------------------------------------------- the counter and the quota */

/**
 * The object counter for a tenant, seeding it from a real measure the first time this host is
 * asked. Server mode only: off it there is no ceiling and nothing to keep a counter for, and a
 * desktop must not be made to open a database table to save an image.
 */
async function objectUse(tenantId: string): Promise<TenantStorageUse & { measuredAt: number | null }> {
  if (!isServerMode()) {
    const measured = await tenantObjectStore().measure(tenantId);
    return { ...measured, measuredAt: Date.now() };
  }
  const existing: TenantStorageCounter | null = readTenantStorageCounter(tenantId);
  if (existing) {
    return { usedBytes: existing.bytesUsed, objectCount: existing.objectCount, measuredAt: existing.measuredAt };
  }
  // No row yet. Seeding from a measure rather than from zero is what stops an upgrade — or a
  // restored data volume — from declaring an existing tree empty and handing the tenant a second
  // whole allowance on top of what they already hold.
  const measured = await tenantObjectStore().measure(tenantId);
  const seeded = setTenantStorageCounter(tenantId, {
    bytesUsed: measured.usedBytes,
    objectCount: measured.objectCount,
  });
  return { usedBytes: seeded.bytesUsed, objectCount: seeded.objectCount, measuredAt: seeded.measuredAt };
}

/** Objects plus job trees: the one number the report shows and the refusal uses. */
async function totalUse(tenantId: string): Promise<{ objects: TenantStorageUse; jobs: TenantStorageUse }> {
  const [objects, jobs] = await Promise.all([objectUse(tenantId), measureTenantJobBytes(tenantId)]);
  return { objects, jobs };
}

/**
 * A write refused on **storage**, not on the key and not on the plan.
 *
 * Same flat-403 shape as `GatewayBlockedError` and `PlanBlockedError` so `jsonError` and the
 * renderer's parser keep working, and a third code on purpose: `gateway_blocked` sends the renderer
 * to the paste-your-key onboarding screen, which is a dead end for a tenant whose actual problem is
 * that their prefix is full.
 */
export class StorageQuotaError extends ApiError {
  readonly usedBytes: number;
  readonly limitBytes: number;

  constructor(usedBytes: number, limitBytes: number) {
    super(STORAGE_BLOCK, STORAGE_BLOCK_MESSAGE, 403);
    this.name = "StorageQuotaError";
    this.usedBytes = usedBytes;
    this.limitBytes = limitBytes;
  }
}

export function isStorageQuotaError(error: unknown): error is StorageQuotaError {
  return error instanceof StorageQuotaError;
}

/**
 * What this tenant is holding and what it is allowed to hold.
 *
 * `usedBytes` is objects plus job trees. `limitBytes` is `null` off server mode, which is what
 * makes the desktop exempt by construction: it measures and reports, and refuses nothing.
 */
export async function tenantStorageReport(
  tenantId: string,
): Promise<TenantStorageReport & { objectBytes: number; jobBytes: number; backend: ObjectStorageKind }> {
  assertTenantId(tenantId);
  const { objects, jobs } = await totalUse(tenantId);
  const report = storageReport(
    { usedBytes: objects.usedBytes + jobs.usedBytes, objectCount: objects.objectCount + jobs.objectCount },
    tenantStorageLimitBytes(),
  );
  return { ...report, objectBytes: objects.usedBytes, jobBytes: jobs.usedBytes, backend: tenantObjectStore().kind };
}

/**
 * May this tenant store `incomingBytes` more? Throws `StorageQuotaError` when not.
 *
 * `replacingBytes` is what the write is about to overwrite, so re-saving a 10 MB object at the same
 * key costs nothing rather than 10 MB. It is a separate argument rather than a `head()` inside this
 * function because the caller already knows it on the one path where it is not zero.
 */
export async function assertStorageAdmits(tenantId: string, incomingBytes: number, replacingBytes = 0): Promise<void> {
  const limitBytes = tenantStorageLimitBytes();
  if (limitBytes === null) {
    return;
  }
  const { objects, jobs } = await totalUse(tenantId);
  const usedBytes = Math.max(0, objects.usedBytes + jobs.usedBytes - Math.max(0, replacingBytes));
  const verdict = storageAdmission({ usedBytes, incomingBytes, limitBytes });
  if (!verdict.ok) {
    log.warn("tenant_storage_quota_refused", { tenantId, usedBytes, limitBytes, incomingBytes });
    throw new StorageQuotaError(usedBytes, limitBytes);
  }
}

/**
 * One tenant's in-flight writes, so the quota check and the counter move cannot interleave.
 *
 * The SQL delta is already atomic against the row (`tenant-storage-store.ts`), which keeps the
 * counter correct — but correct-after-the-fact is not the same as enforced. Two 600-byte uploads
 * arriving together under a 1000-byte ceiling both read 100, both admitted, and the tenant ended at
 * 1300. The overshoot was bounded (in-flight writes × the per-file cap) but it was real, and on a
 * 500 MB Edit import the bound is not small.
 *
 * A promise chain per tenant is the whole mechanism: each write waits for the previous one to
 * finish check-put-count before starting its own. It serialises one tenant's writes **in this
 * process** only, which is the honest limit — two hosts behind the proxy would still race, and the
 * fix for that is a conditional update in SQL, not a mutex. The chain is cleared when it drains so
 * the map cannot grow with the tenant list.
 */
const putChains = new Map<string, Promise<unknown>>();

function serializePut<T>(tenantId: string, run: () => Promise<T>): Promise<T> {
  const previous = putChains.get(tenantId) ?? Promise.resolve();
  // `run` on both settlement paths: one failed write must not fail every write queued behind it.
  const next = previous.then(run, run);
  // The chain the next writer waits on never rejects, for the same reason.
  const tail = next.then(
    () => undefined,
    () => undefined,
  );
  putChains.set(tenantId, tail);
  void tail.then(() => {
    // Only when nothing newer has taken the slot: otherwise a queued write loses its predecessor.
    if (putChains.get(tenantId) === tail) {
      putChains.delete(tenantId);
    }
  });
  return next;
}

/**
 * Store an object for a tenant: quota first, backend second, counter third.
 *
 * The order matters. The check runs before the bytes are written, so a refusal never leaves a
 * partial object behind; the counter moves only after the backend has taken the write, so a failed
 * put never charges the tenant for bytes nobody stored. All three steps run inside this tenant's
 * write chain, so a second write cannot read the counter between them.
 */
export async function putTenantObject(
  tenantId: string,
  key: string,
  bytes: Uint8Array,
  contentType: string,
): Promise<void> {
  assertObjectKey(tenantId, key);
  return serializePut(tenantId, async () => {
    const store = tenantObjectStore();
    const existing = await store.head(tenantId, key);
    await assertStorageAdmits(tenantId, bytes.byteLength, existing?.sizeBytes ?? 0);
    await store.put(tenantId, key, bytes, contentType);
    if (isServerMode()) {
      addTenantStorageBytes(tenantId, {
        bytes: bytes.byteLength - (existing?.sizeBytes ?? 0),
        objects: existing ? 0 : 1,
      });
    }
  });
}

/** Read a whole object. A key that is not this tenant's is a 404 before any IO. */
export async function readTenantObject(tenantId: string, key: string): Promise<Uint8Array> {
  return tenantObjectStore().read(tenantId, key);
}

/** Serve a `Range` request over an object. */
export async function readTenantObjectRange(
  tenantId: string,
  key: string,
  rangeHeader: string | undefined,
): Promise<RangedBytes> {
  return tenantObjectStore().readRange(tenantId, key, rangeHeader);
}

/** Delete an object and give the tenant its bytes back. Idempotent. */
export async function removeTenantObject(tenantId: string, key: string): Promise<void> {
  assertObjectKey(tenantId, key);
  const store = tenantObjectStore();
  const existing = await store.head(tenantId, key);
  await store.remove(tenantId, key);
  if (existing && isServerMode()) {
    addTenantStorageBytes(tenantId, { bytes: -existing.sizeBytes, objects: -1 });
  }
}

/**
 * A **local file path** for an object, because some readers cannot be handed bytes.
 *
 * ffmpeg and ffprobe take paths, not buffers: they open the file themselves, seek in it, and on a
 * long clip read a fraction of it. Under the file backend that path is the object itself and
 * nothing is copied. Under COS there is no such path, so the object is downloaded once into the
 * tenant's own cache directory and reused while it is still the right size.
 *
 * **The cache is the host's cost, not the tenant's.** It lives under
 * `<tenantDataDir>/cache/objects/` — outside `tenantJobRoots`, so it is never counted against the
 * quota. A tenant would otherwise be charged twice for one video: once in the bucket, once for the
 * copy the host made in order to read it.
 *
 * The cache file keeps the object's own extension, because ffmpeg still sniffs some containers by
 * name, and its directory is the key's SHA-256 so two keys can never collide on a basename.
 */
export async function materializeTenantObject(tenantId: string, key: string): Promise<string> {
  assertObjectKey(tenantId, key);
  const store = tenantObjectStore();
  if (store.kind === "file") {
    return objectPath(tenantId, key);
  }
  const head = await store.head(tenantId, key);
  if (!head) {
    objectNotFound();
  }
  const digest = createHash("sha256").update(`${tenantId}\u0000${key}`).digest("hex");
  const dir = path.join(tenantObjectCacheRoot(tenantId), digest);
  const target = path.join(dir, path.basename(key));
  try {
    if ((await stat(target)).size === head.sizeBytes) {
      return target;
    }
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
  const bytes = await store.read(tenantId, key);
  await mkdir(dir, { recursive: true });
  // Temp file then rename: two jobs on the same asset must not have one of them read half a file.
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, target);
  return target;
}

/**
 * Re-measure a tenant from the backend and overwrite the counter. The operator's reconciliation,
 * and the one thing that fixes a drift. Server mode only — off it there is no counter to fix.
 */
export async function recomputeTenantStorage(tenantId: string): Promise<TenantStorageUse> {
  assertTenantId(tenantId);
  const measured = await tenantObjectStore().measure(tenantId);
  if (isServerMode()) {
    setTenantStorageCounter(tenantId, { bytesUsed: measured.usedBytes, objectCount: measured.objectCount });
  }
  forgetTenantJobBytes(tenantId);
  log.info("tenant_storage_recomputed", {
    tenantId,
    bytes: measured.usedBytes,
    objects: measured.objectCount,
    backend: tenantObjectStore().kind,
  });
  return measured;
}
