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
import { assertTenantId, tenantSegments, TENANTS_DIR } from "./tenant-paths";

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
  /** Where the object lives, for a log line or an error message. Never its bytes. */
  describe(tenantId: string, key: string): string;
}
