import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { mediaRoot, tenantMediaRoot } from "../../media-root";
import { assertPathSegment, tenantDataDir, tenantDeniedRoots, tenantObjectCacheRoot } from "../../tenant-paths";

function pathDenied(message: string): never {
  throw new ApiError("path_denied", message, 400);
}

function isUncOrDevice(value: string): boolean {
  return (
    value.startsWith("\\\\") ||
    value.startsWith("//") ||
    value.startsWith("\\\\?\\") ||
    value.startsWith("\\\\.\\") ||
    /^\/\/\?\/|^\/\/\.\//.test(value)
  );
}

function isDriveRelative(value: string): boolean {
  return /^[A-Za-z]:(?![\\/])/.test(value);
}

function normalizeForCompare(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function relativeInside(root: string, candidate: string): boolean {
  const rel = path.relative(normalizeForCompare(root), normalizeForCompare(candidate));
  if (!rel) {
    return true;
  }
  if (path.isAbsolute(rel)) {
    return false;
  }
  const first = rel.split(/[\\/]/)[0];
  return first !== "..";
}

/** Whose files an ffmpeg run may touch. `projectId` alone was the pre-Phase-3 answer. */
export type EditScope = { tenantId: string; projectId: string };

/**
 * Where a path guard may let ffmpeg read and write.
 *
 * `denied` exists because the local tenant's root *is* the install root (`tenant-paths.ts`), so
 * every other tenant's media sits inside it. A denial is checked first and always wins, which is
 * what stops an `ffmpeg` argument crafted from a project document reaching another tenant's tree.
 */
export type PathAllowlist = {
  roots: readonly string[];
  denied: readonly string[];
};

/** `<dataDir>/edit/<projectId>` for the local tenant; under `tenants/<tenantId>/` for anyone else. */
export function editScratchRoot(scope: EditScope): string {
  return path.join(tenantDataDir(scope.tenantId), "edit", assertPathSegment(scope.projectId, "Project id"));
}

export function editAllowlist(scope: EditScope): PathAllowlist {
  const scratch = editScratchRoot(scope);
  return {
    // The object cache is the third root because under the COS backend an asset has no path in the
    // media root at all: `materializeTenantObject` downloads it to `tenantObjectCacheRoot` and hands
    // ffmpeg that. Without it every probe, frame, render, silence scan and audio extract on a
    // COS-backed asset is refused as `path_denied`, which is the whole of Edit for a hosted tenant.
    // It is still one tenant's own directory, and the denials below still win over all three roots.
    roots: [tenantMediaRoot(scope.tenantId), scratch, tenantObjectCacheRoot(scope.tenantId)],
    denied: [...tenantDeniedRoots(mediaRoot(), scope.tenantId), ...tenantDeniedRoots(localDataDir(), scope.tenantId)],
  };
}

export function escapeFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

export function assertInsidePath(candidate: string, allow: PathAllowlist): string {
  if (!candidate || !candidate.trim()) {
    pathDenied("empty path");
  }
  if (candidate.includes("\0")) {
    pathDenied("NUL in path");
  }
  if (isUncOrDevice(candidate)) {
    pathDenied("UNC or device path");
  }
  if (isDriveRelative(candidate)) {
    pathDenied("drive-relative path");
  }

  const resolved = path.resolve(candidate);
  let real = resolved;
  try {
    if (existsSync(resolved)) {
      real = realpathSync(resolved);
    } else {
      const parent = path.dirname(resolved);
      if (!existsSync(parent)) {
        pathDenied("parent directory missing");
      }
      const parentReal = realpathSync(parent);
      real = path.join(parentReal, path.basename(resolved));
    }
  } catch {
    pathDenied("path could not be canonicalized");
  }

  const matches = (root: string): boolean => {
    const rootReal = existsSync(root) ? realpathSync(root) : path.resolve(root);
    return relativeInside(rootReal, real);
  };
  // Denials first: a tree that belongs to another tenant is refused even though it sits inside a
  // root this tenant is otherwise allowed to reach.
  if (allow.denied.some(matches)) {
    pathDenied("path belongs to another tenant");
  }
  if (!allow.roots.some(matches)) {
    pathDenied("path outside allowlist");
  }
  return real;
}

export function assertExistingInput(candidate: string, allow: PathAllowlist): string {
  const real = assertInsidePath(candidate, allow);
  if (!existsSync(real) || lstatSync(real).isDirectory()) {
    pathDenied("input does not exist");
  }
  return real;
}
