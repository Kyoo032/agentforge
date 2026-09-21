/**
 * Phase 6 — what an object key is, and the one test that says whose it is.
 *
 * Split out of `tenant-storage.ts` so the COS backend can check a key without importing the module
 * that builds it — the two would otherwise be a cycle, and a cycle around a security guard is the
 * kind of thing that resolves differently under a bundler than under `tsx`.
 *
 * A key is the on-disk layout spelled with slashes: `tenants/<id>/<org>/<uuid>.png` in a bucket is
 * `<mediaRoot>/tenants/<id>/<org>/<uuid>.png` on disk, and the local tenant keeps the bare root in
 * both (Phase 3 lane D's one rule, `tenant-paths.ts`). Everything here is pure string work — no
 * filesystem, no network — so it runs before any IO on every path, in both backends.
 */
import { ApiError } from "@agentforge/core";
import type { ObjectStorageKind, TenantStorageUse } from "@agentforge/core";
import type { RangedBytes } from "./byte-range";
import { assertTenantId, isLocalTenant, tenantSegments, TENANTS_DIR } from "./tenant-paths";

/** No key may be longer than this. COS's own limit is 850 bytes UTF-8; this is well under it. */
const KEY_MAX = 512;

/**
 * A key that does not belong to this tenant is a 404, not a 403.
 *
 * The same answer `mediaFilePath` has given since lane D, and for the same reason: a tenant asking
 * for another tenant's object must not be able to tell the difference between "that is not yours"
 * and "that does not exist", or the error itself becomes an existence oracle over everyone's ids.
 */
export function objectNotFound(): never {
  throw new ApiError("not_found", "That file is not available on this account", 404);
}

/**
 * The pure, filesystem-free twin of `isInsideTenantRoot`.
 *
 * A key is a `/`-joined relative path, exactly what goes in a `storage_path` column. It must:
 * be non-empty and within `KEY_MAX`; carry no NUL, no backslash and no Windows drive letter; be
 * relative (no leading `/`); contain no empty, `.` or `..` segment; and sit under this tenant's
 * prefix — `tenants/<id>/…` for a hosted tenant, and for the local tenant **anything that is not
 * under `tenants/`**, which is lane D's one exception spelled as a string test.
 *
 * Returns the key unchanged. It deliberately does not normalise anything: a key that needs
 * normalising is a key somebody constructed wrong, and silently repairing it is how the repaired
 * form and the stored form drift apart.
 */
export function assertObjectKey(tenantId: string, key: string): string {
  assertTenantId(tenantId);
  if (typeof key !== "string" || key.length === 0 || key.length > KEY_MAX) {
    objectNotFound();
  }
  if (key.includes("\0") || key.includes("\\") || /^[A-Za-z]:/.test(key) || key.startsWith("/")) {
    objectNotFound();
  }
  const segments = key.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    objectNotFound();
  }
  const prefix = tenantSegments(tenantId);
  if (prefix.length === 0) {
    // The local tenant's root IS the install root, so every other tenant's subtree sits inside it.
    // `tenants/` is therefore the one thing the local tenant may not reach — the string form of
    // `tenantDeniedRoots`.
    if (segments[0] === TENANTS_DIR) {
      objectNotFound();
    }
    return key;
  }
  if (segments.length <= prefix.length || segments[0] !== prefix[0] || segments[1] !== prefix[1]) {
    objectNotFound();
  }
  return key;
}

/** True when `key` belongs to `tenantId`, without throwing. For sweeps and tests. */
export function isObjectKeyInsideTenant(tenantId: string, key: string): boolean {
  try {
    assertObjectKey(tenantId, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Phase 8 — may a whole-prefix delete run for this tenant at all?
 *
 * Only `local-tenant` is refused, and it is refused here rather than at the caller, because the
 * reason is a property of the layout and not of any one route: lane D gives the local tenant the
 * *bare root* in both the bucket and the tree, so "delete everything under this tenant's prefix"
 * is literally "delete everything", including every hosted tenant's objects. The hosted reset
 * never resolves the local tenant, and a mis-resolved one must hit a wall here rather than an
 * `rm -rf`.
 *
 * A 400 rather than a 404: this is not a key that might or might not exist, it is a request that
 * does not mean what it says, and the operator reading the log deserves to see that difference.
 */
export function assertPurgeableTenant(tenantId: string): string {
  assertTenantId(tenantId);
  if (isLocalTenant(tenantId)) {
    throw new ApiError(
      "storage_purge_refused",
      "The local tenant's prefix is the whole store, so it cannot be purged as a tenant.",
      400,
    );
  }
  return tenantId;
}

/** The key prefix every one of this tenant's objects starts with. `""` for the local tenant. */
export function tenantKeyPrefix(tenantId: string): string {
  const segments = tenantSegments(tenantId);
  return segments.length === 0 ? "" : `${segments.join("/")}/`;
}

/* ---------------------------------------------------------------------------- the interface */

export type ObjectHead = { readonly sizeBytes: number };

/**
 * Durable per-tenant object storage. Every method takes the tenant whose request this is and
 * refuses a key that is not theirs *before* touching the backend.
 */
export interface TenantObjectStore {
  readonly kind: ObjectStorageKind;
  put(tenantId: string, key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  read(tenantId: string, key: string): Promise<Uint8Array>;
  /** A `Range` request, served without reading the whole object where the backend allows it. */
  readRange(tenantId: string, key: string, rangeHeader: string | undefined): Promise<RangedBytes>;
  /** `null` when the object is not there. Never throws for a missing object. */
  head(tenantId: string, key: string): Promise<ObjectHead | null>;
  /** Idempotent: removing what is not there is not an error. */
  remove(tenantId: string, key: string): Promise<void>;
  /** Walk or list everything under this tenant's prefix. The authority the counter caches. */
  measure(tenantId: string): Promise<TenantStorageUse>;
  /**
   * Phase 8 — remove everything under this tenant's prefix, and report what went.
   *
   * The one operation that is not keyed, which is why it carries a guard the others do not need:
   * **the local tenant has no prefix** (lane D gives it the bare root, `tenantKeyPrefix` returns
   * `""`), so "everything under its prefix" is every other tenant's objects as well. Both backends
   * therefore refuse `local-tenant` outright rather than interpreting it. That refusal is the only
   * thing standing between a mis-resolved tenant id and an empty bucket.
   *
   * Idempotent: a prefix with nothing under it removes nothing and reports zero. Not atomic — a
   * backend can fail half way — so the caller must be safe to retry, which is what makes the
   * reset's "run it again" the right answer to a partial failure.
   */
  removePrefix(tenantId: string): Promise<TenantStorageUse>;
  /** Where the object lives, for a log line or an error message. Never its bytes. */
  describe(tenantId: string, key: string): string;
}

/**
 * How much a purge had already deleted when it threw.
 *
 * `removePrefix` returns its totals, and a throw returns nothing — so a backend that refuses half
 * way through a prefix used to leave the reset's audit row reporting zero objects and zero bytes
 * after some had actually gone. That row is the only record of a failed reset, and a row that says
 * "nothing happened" about a partial delete is worse than no row: it is the one number an operator
 * would use to decide whether a retry is safe, and it was wrong in the direction that matters.
 *
 * Carried on the error rather than returned, because the throw is the whole point — the caller
 * must still fail — and a second return channel would mean every caller remembering to read it.
 */
const PURGE_PROGRESS = Symbol.for("agentforge.purgeProgress");

/** Stamp what had gone onto the error on its way out of a purge. Returns the same error. */
export function withPurgeProgress<E>(error: E, progress: TenantStorageUse): E {
  if (typeof error === "object" && error !== null) {
    Object.defineProperty(error, PURGE_PROGRESS, {
      value: { usedBytes: progress.usedBytes, objectCount: progress.objectCount },
      enumerable: false,
      configurable: true,
    });
  }
  return error;
}

/** What a failed purge had already deleted, or null when the error carries no count. */
export function purgeProgressOf(error: unknown): TenantStorageUse | null {
  if (typeof error !== "object" || error === null) {
    return null;
  }
  const carried = (error as Record<symbol, unknown>)[PURGE_PROGRESS];
  if (typeof carried !== "object" || carried === null) {
    return null;
  }
  const { usedBytes, objectCount } = carried as Partial<TenantStorageUse>;
  if (typeof usedBytes !== "number" || typeof objectCount !== "number") {
    return null;
  }
  return { usedBytes, objectCount };
}
