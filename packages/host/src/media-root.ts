import path from "node:path";
import { ApiError } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { resolveInsideTenantRoot, tenantRelativePath, tenantScopedRoot } from "./tenant-paths";

export function mediaRoot(): string {
  if (process.env.MEDIA_ROOT) {
    return path.resolve(process.env.MEDIA_ROOT);
  }
  return path.resolve(localDataDir(), "media");
}

/**
 * Phase 3 lane D: `<mediaRoot>` for the local tenant, `<mediaRoot>/tenants/<tenantId>` for every
 * other tenant. See `tenant-paths.ts` for why the local tenant keeps the bare root.
 */
export function tenantMediaRoot(tenantId: string): string {
  return tenantScopedRoot(mediaRoot(), tenantId);
}

/**
 * The `storage_path` a new blob is recorded under: tenant prefix, then the segments the caller
 * keys on (an organization id, or `knowledge/<organizationId>`), then the file name.
 */
export function mediaRelativePath(tenantId: string, segments: readonly string[], filename: string): string {
  return tenantRelativePath(tenantId, segments, filename);
}

/**
 * Resolve a `storage_path` read back out of the database against the media root, refusing one that
 * does not belong to this tenant. Rows written before Phase 3 carry `<organizationId>/<file>` with
 * no prefix, which is exactly the local tenant's layout, so they keep resolving.
 */
export function mediaFilePath(tenantId: string, storagePath: string): string {
  const root = mediaRoot();
  // Symlinks resolved, not just `..` segments: a link planted under this tenant's subtree passes a
  // lexical test while pointing at another tenant's file. The resolved path is what comes back, so
  // the caller opens what was checked and not the link.
  const real = resolveInsideTenantRoot(root, tenantId, path.resolve(root, storagePath));
  if (real === null) {
    throw new ApiError("not_found", "Media is not available on this desk", 404);
  }
  return real;
}
