/**
 * Turning verified bytes into a directory, atomically.
 *
 * Nothing is ever written into `<root>`: entries land in a sibling `<root>.tmp-<random>` which is
 * renamed into place only once every package unpacked and nothing threw. A failed or interrupted run
 * therefore leaves a tmp directory and an untouched (or absent) `<root>`, and the next run sweeps
 * the stale tmp dirs before it starts.
 */
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { readTarGz } from "./tar";
import { ComponentError } from "./types";
import type { ComponentPackage } from "./manifest";

/** Belt and braces: the tar reader already refuses an escaping name, this refuses the joined path. */
function assertInside(root: string, target: string): void {
  const rel = relative(root, target);
  if (!rel || rel.startsWith("..") || rel.startsWith(`..${sep}`) || resolve(root, rel) !== target) {
    throw new ComponentError("unpack_failed", `entry ${JSON.stringify(rel)} resolves outside the component directory`);
  }
}

/** Owner-writable, group/other read-only; the executable bit is kept for a binary that carries it. */
function fileMode(mode: number): number {
  return mode & 0o111 ? 0o755 : 0o644;
}

/** Unpack one package's tarball into `<dir>/node_modules/<name>/`. Rejects a bomb before writing. */
export function unpackPackage(modulesDir: string, pkg: ComponentPackage, tarball: Buffer): number {
  const entries = readTarGz(tarball, {
    // Twice the manifest's figure: enough slack for a re-publish that rounds differently, far from
    // enough for an archive that is not the package we pinned.
    maxTotalBytes: pkg.unpackedBytes * 2,
    maxEntries: 2000,
  });
  const target = resolve(modulesDir, ...pkg.name.split("/"));
  mkdirSync(target, { recursive: true });
  let written = 0;
  for (const entry of entries) {
    const path = resolve(target, entry.path);
    assertInside(target, path);
    if (entry.directory) {
      mkdirSync(path, { recursive: true });
      continue;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, entry.data, { mode: fileMode(entry.mode) });
    written += entry.data.byteLength;
  }
  return written;
}

/**
 * npm resolves an optional platform package through the main package's own `node_modules` lookup,
 * which walks up from the requiring file. Both packages are siblings under one `node_modules`, so a
 * plain flat layout is all that is needed — no store, no symlinks, no manifest rewriting.
 */
export function createStagingDir(root: string): string {
  mkdirSync(dirname(root), { recursive: true });
  return mkdtempSync(`${root}.tmp-`);
}

/** Remove every `<root>.tmp-*` left by an interrupted run. Best-effort; a locked one is skipped. */
export function cleanStaleStaging(root: string): string[] {
  const parent = dirname(root);
  const prefix = `${basename(root)}.tmp-`;
  let names: string[];
  try {
    names = readdirSync(parent);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of names) {
    if (!name.startsWith(prefix)) {
      continue;
    }
    try {
      rmSync(join(parent, name), { recursive: true, force: true });
      removed.push(name);
    } catch {
      // Another process may still hold it; the next run tries again.
    }
  }
  return removed;
}

/** Move the staged directory over `<root>`. The previous copy (if any) is a failed install. */
export function promoteStaging(staging: string, root: string): void {
  try {
    rmSync(root, { recursive: true, force: true });
    renameSync(staging, root);
  } catch (error) {
    throw new ComponentError(
      "unpack_failed",
      `could not move the unpacked files into place: ${error instanceof Error ? error.message : "unknown"}`,
    );
  }
}
