import { existsSync, lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { ApiError } from "@agentforge/core";
import { localDataDir } from "@agentforge/db/vault-key";
import { mediaRoot } from "../../media-root";

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

export function editScratchRoot(projectId: string): string {
  return path.join(localDataDir(), "edit", projectId);
}

export function editAllowlistRoots(projectId: string): string[] {
  return [mediaRoot(), editScratchRoot(projectId)];
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

export function assertInsidePath(candidate: string, roots: string[]): string {
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

  const inside = roots.some((root) => {
    const rootReal = existsSync(root) ? realpathSync(root) : path.resolve(root);
    return relativeInside(rootReal, real);
  });
  if (!inside) {
    pathDenied("path outside allowlist");
  }
  return real;
}

export function assertExistingInput(candidate: string, roots: string[]): string {
  const real = assertInsidePath(candidate, roots);
  if (!existsSync(real) || lstatSync(real).isDirectory()) {
    pathDenied("input does not exist");
  }
  return real;
}
