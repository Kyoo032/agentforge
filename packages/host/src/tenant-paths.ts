/**
 * Phase 3 lane D — the one place a tenant turns into a directory.
 *
 * The rule, and there is only one: **`local-tenant`'s storage root is the install root itself;
 * every other tenant gets a `tenants/<tenantId>/` subtree inside it.**
 *
 * `local-tenant` is not a tenant someone signed up for — it is the id migration `0015` stamped onto
 * the single organization every pre-Phase-3 database already had (`packages/core/src/local-owner.ts:7`). Its files
 * are the install's files. Giving it a prefix would mean moving a desktop user's media, matters and
 * `settings.enc` on upgrade, so it keeps the layout it has and nothing is moved: a desktop data
 * directory is byte-identical before and after this change, and every `storage_path` already in
 * `media` / `datasets` still resolves verbatim.
 *
 * The one thing that rule costs: a second tenant's subtree sits *inside* the local tenant's root, so
 * "is this path mine?" is not a plain prefix test for the local tenant. `tenantDeniedRoots` is that
 * exception, made explicit, and `isInsideTenantRoot` is the check every path guard should use.
 */
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { ApiError, LOCAL_TENANT_ID } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";

/** The directory that holds every non-local tenant. Reserved: no id may be spelled this. */
export const TENANTS_DIR = "tenants";

/**
 * Same shape as `assertSafeId` in `legal/store-files.ts:38`. Deliberately narrower than "a string":
 * a tenant id reaches the filesystem, so `..`, `/`, `\`, a drive letter and a NUL are all rejected
 * by not matching rather than by being listed.
 */
const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,80}$/;

function denied(message: string): never {
  throw new ApiError("invalid_request", message, 400);
}

export function assertTenantId(tenantId: string): string {
  if (!SAFE_SEGMENT.test(tenantId) || tenantId === TENANTS_DIR) {
    denied("Tenant id is malformed");
  }
  return tenantId;
}

/**
 * A caller-supplied path segment. `tenants` is rejected everywhere, not only in first position: the
 * local tenant's prefix is empty, so a segment spelled `tenants` would be indistinguishable from
 * another tenant's subtree.
 */
export function assertPathSegment(segment: string, label: string): string {
  if (!SAFE_SEGMENT.test(segment) || segment === TENANTS_DIR) {
    denied(`${label} is malformed`);
  }
  return segment;
}

export function isLocalTenant(tenantId: string): boolean {
  return assertTenantId(tenantId) === LOCAL_TENANT_ID;
}

/** The segments a tenant adds under a shared root. Empty for the local tenant, by the rule above. */
export function tenantSegments(tenantId: string): string[] {
  return isLocalTenant(tenantId) ? [] : [TENANTS_DIR, tenantId];
}

/** `root` for the local tenant; `<root>/tenants/<tenantId>` for every other tenant. */
export function tenantScopedRoot(root: string, tenantId: string): string {
  return path.join(root, ...tenantSegments(tenantId));
}

/**
 * A `/`-joined relative path under a shared root, tenant-prefixed. This is what goes into a
 * `storage_path` column, so it stays POSIX-shaped on every platform exactly as the pre-Phase-3
 * writers did (`media.ts:47`).
 */
export function tenantRelativePath(tenantId: string, segments: readonly string[], filename: string): string {
  assertTenantId(tenantId);
  const checked = segments.map((segment, index) => assertPathSegment(segment, `Path segment ${index + 1}`));
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("\0")) {
    denied("Filename is malformed");
  }
  if (filename === "." || filename === "..") {
    denied("Filename is malformed");
  }
  return [...tenantSegments(tenantId), ...checked, filename].join("/");
}

/** `<dataDir>` for the local tenant; `<dataDir>/tenants/<tenantId>` otherwise. */
export function tenantDataDir(tenantId: string): string {
  return tenantScopedRoot(localDataDir(), tenantId);
}

/**
 * Where the host keeps its own local copies of a tenant's objects.
 *
 * Phase 6: under the COS backend there is no local path for an object, so `materializeTenantObject`
 * downloads one here for the readers that cannot be handed bytes — ffmpeg and ffprobe open a file,
 * seek in it and read a fraction of a long clip. It lives under the tenant's own data directory so
 * one tenant's cache can never be another's, and it is deliberately **not** a `tenantJobRoots`
 * entry: the copy is the host's cost, and charging a tenant twice for one video would be wrong.
 *
 * It is declared here, beside the other per-tenant roots, rather than in `tenant-storage.ts`,
 * because `edit/ffmpeg/paths.ts` has to allow it and must not import the storage module to do it.
 */
export function tenantObjectCacheRoot(tenantId: string): string {
  return path.join(tenantDataDir(tenantId), "cache", "objects");
}

/**
 * Sub-trees of a tenant's own root that are *not* that tenant's. Only the local tenant has any:
 * its root is the install root, so `tenants/` inside it belongs to everybody else.
 */
export function tenantDeniedRoots(root: string, tenantId: string): string[] {
  return isLocalTenant(tenantId) ? [path.join(root, TENANTS_DIR)] : [];
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/** True when `candidate` is at or under `root` — no `..`, no sibling that merely shares a prefix. */
export function isInside(root: string, candidate: string): boolean {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(candidate));
  if (!rel) {
    return true;
  }
  return !path.isAbsolute(rel) && rel.split(/[\\/]/)[0] !== "..";
}

/**
 * The containment test every per-tenant path guard should use: inside this tenant's root, and not
 * inside a subtree that belongs to another tenant.
 */
export function isInsideTenantRoot(root: string, tenantId: string, candidate: string): boolean {
  const scoped = tenantScopedRoot(root, tenantId);
  if (!isInside(scoped, candidate)) {
    return false;
  }
  return !tenantDeniedRoots(root, tenantId).some((other) => isInside(other, candidate));
}

/**
 * `path.resolve` follows no symlinks, so a link planted inside a tenant's subtree passes a purely
 * lexical containment test while pointing anywhere on disk. Canonicalise before comparing — the
 * file itself when it exists, otherwise its parent directory, so a path about to be written is
 * still checked against the real tree. Returns null only when neither exists, in which case there
 * is nothing on disk to be a link and the caller falls back to the lexical test.
 *
 * `edit/ffmpeg/paths.ts` `assertInsidePath` does the same thing for ffmpeg arguments; this is that
 * rule, shared, so every per-tenant guard resolves rather than only some of them.
 */
export function realPathOrNull(candidate: string): string | null {
  const resolved = path.resolve(candidate);
  try {
    if (existsSync(resolved)) {
      return realpathSync(resolved);
    }
    const parent = path.dirname(resolved);
    if (!existsSync(parent)) {
      return null;
    }
    return path.join(realpathSync(parent), path.basename(resolved));
  } catch {
    return null;
  }
}

/** A root canonicalised when it exists, plain-resolved when it does not. */
function realRoot(root: string): string {
  try {
    return existsSync(root) ? realpathSync(root) : path.resolve(root);
  } catch {
    return path.resolve(root);
  }
}

/**
 * The containment test for a path that will actually be opened: `isInsideTenantRoot` with symlinks
 * resolved on both sides. Returns the path to open — canonical when the tree exists — or null when
 * it does not belong to this tenant.
 *
 * Returning the resolved path rather than a boolean is the point: the caller then opens what was
 * checked, not the link that was checked.
 *
 * When nothing along the path exists, this is exactly the lexical test, because a path with no file
 * and no parent directory cannot be a symlink to anywhere.
 */
export function resolveInsideTenantRoot(root: string, tenantId: string, candidate: string): string | null {
  const resolved = path.resolve(candidate);
  const real = realPathOrNull(resolved);
  if (real === null) {
    return isInsideTenantRoot(root, tenantId, resolved) ? resolved : null;
  }
  const scoped = realRoot(tenantScopedRoot(root, tenantId));
  if (!isInside(scoped, real)) {
    return null;
  }
  if (tenantDeniedRoots(root, tenantId).some((other) => isInside(realRoot(other), real))) {
    return null;
  }
  return real;
}
