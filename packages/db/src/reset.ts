/**
 * "Start over" wipe, staged across a relaunch.
 *
 * The host writes a marker while the app is running; the database is open, so the files can only be
 * deleted on the next boot, before anything holds a handle on them. `packages/db/src/client.ts` runs
 * this at boot, but only for a process that set `AGENTFORGE_APPLY_PENDING_RESET=1`.
 *
 * The data dir is ALSO Electron's userData / Chromium profile dir in the packaged app, so this
 * never removes the directory itself. Only named, relative entries the host owns are deleted, plus
 * the SQLite trio this package owns.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { localDataDir, sqliteFilePath } from "./vault-key";

export const RESET_MARKER_FILE = "reset-pending.json";

/** Owned by this package, so every wipe removes them whether or not the caller listed them. */
const SQLITE_ENTRIES = ["agentforge.sqlite", "agentforge.sqlite-wal", "agentforge.sqlite-shm"] as const;

export type ResetMarker = {
  version: 1;
  requestedAt: string;
  entries: string[];
};

export type ResetOutcome = {
  applied: boolean;
  removed: string[];
};

/** Why `entry` may not be wiped, or null when it is a safe relative name inside the data dir. */
function rejectReason(entry: unknown): string | null {
  if (typeof entry !== "string") {
    return "must be a string";
  }
  const value = entry.trim();
  if (!value) {
    return "must not be empty";
  }
  if (isAbsolute(value) || /^[A-Za-z]:/.test(value)) {
    return "must be relative";
  }
  if (/^[\\/]/.test(value)) {
    return "must not start with a path separator";
  }
  if (value.split(/[\\/]/).some((segment) => segment === "..")) {
    return "must not contain ..";
  }
  return null;
}

function assertResetEntries(entries: readonly string[]): string[] {
  return entries.map((entry) => {
    const reason = rejectReason(entry);
    if (reason) {
      return raise(entry, reason);
    }
    return entry.trim();
  });
}

function raise(entry: unknown, reason: string): never {
  throw new Error(`Invalid reset entry ${JSON.stringify(entry)}: it ${reason}.`);
}

function markerPath(dir: string): string {
  return resolve(dir, RESET_MARKER_FILE);
}

/** True when `target` is strictly inside `root` (a symlinked or crafted entry is not). */
function isInside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/**
 * Queue a wipe of `entries` (relative names under `dir`) for the next boot.
 * Throws before writing anything when any entry could escape the data dir.
 */
export function requestDataReset(dir: string, entries: readonly string[]): void {
  const safe = assertResetEntries(entries);
  const marker: ResetMarker = {
    version: 1,
    requestedAt: new Date().toISOString(),
    entries: safe,
  };
  mkdirSync(dir, { recursive: true });
  // Temp file then rename: a crash mid-write must not leave half a marker, which the next boot
  // would read as malformed and delete — silently cancelling the wipe the owner asked for.
  const path = markerPath(dir);
  const temp = `${path}.tmp`;
  writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
  renameSync(temp, path);
}

function readMarker(dir: string): ResetMarker | null {
  const raw = readFileSync(markerPath(dir), "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as { version?: unknown; entries?: unknown };
  if (record.version !== 1 || !Array.isArray(record.entries)) {
    return null;
  }
  return {
    version: 1,
    requestedAt: typeof (parsed as ResetMarker).requestedAt === "string" ? (parsed as ResetMarker).requestedAt : "",
    entries: record.entries.filter((entry): entry is string => typeof entry === "string"),
  };
}

function dropMarker(dir: string): void {
  try {
    unlinkSync(markerPath(dir));
  } catch {
    // Already gone, or the dir is read-only: the wipe itself is what matters.
  }
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

/**
 * Where `target` really lives once its parent directory's symlinks and junctions are followed, or
 * `target` itself when the parent does not exist (nothing to delete, nowhere to escape to).
 */
function realTarget(target: string): string {
  try {
    return resolve(realpathSync.native(dirname(target)), basename(target));
  } catch (error) {
    if (isMissingFile(error)) {
      return target;
    }
    throw error;
  }
}

/** Removes `entry` under `dir` and reports whether something was there. Never throws. */
function removeEntry(root: string, entry: string): boolean {
  const reason = rejectReason(entry);
  if (reason) {
    console.warn(`[agentforge] Skipped reset entry ${JSON.stringify(entry)}: it ${reason}.`);
    return false;
  }
  const target = resolve(root, entry.trim());
  if (!isInside(root, target)) {
    console.warn(`[agentforge] Skipped reset entry ${JSON.stringify(entry)}: it resolves outside the data dir.`);
    return false;
  }
  const existed = existsSync(target);
  try {
    // `media` may be a junction or symlink pointing anywhere. The name check above only proves the
    // spelling is safe, so the parent is resolved for real before anything is deleted recursively.
    const real = realTarget(target);
    if (!isInside(root, real)) {
      console.warn(`[agentforge] Skipped reset entry ${JSON.stringify(entry)}: it links outside the data dir.`);
      return false;
    }
    // Delete the path the check just validated, never the spelling it was derived from: between the
    // two a junction swap could point `target` somewhere `real` never was.
    rmSync(real, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[agentforge] Could not remove ${entry} during reset.`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
  return existed;
}

/**
 * The SQLite trio wherever `DATABASE_URL` actually put it.
 *
 * `SQLITE_ENTRIES` only covers the default spelling relative to the data dir; a desk pointed at
 * `file:D:/elsewhere.sqlite` would keep its whole database through a "Start over". This one path
 * comes from the environment, not from the marker, so it is trusted and skips the `isInside` check.
 * Removed by absolute path, and reported by absolute path, so the outcome says what actually went.
 */
function removeDatabaseElsewhere(root: string): string[] {
  // Only ever for a wipe of *this desk's* data dir. `applyPendingDataReset` takes a directory and
  // the tests point it at a scratch folder; the configured database is not that folder's to delete.
  if (resolve(localDataDir()) !== root) {
    return [];
  }
  let base: string;
  try {
    base = resolve(sqliteFilePath());
  } catch {
    // A DATABASE_URL this package refuses (Postgres): there is no SQLite file to remove.
    return [];
  }
  if (isInside(root, base)) {
    return [];
  }
  const removed: string[] = [];
  for (const path of [base, `${base}-wal`, `${base}-shm`]) {
    // `lstat`, not `stat`: a symlink parked at the database path must be reported, not followed and
    // certainly not deleted along with whatever it points at. Only a plain file is ever removed, so
    // `recursive` has nothing to do here either.
    let stats: ReturnType<typeof lstatSync>;
    try {
      stats = lstatSync(path);
    } catch (error) {
      if (!isMissingFile(error)) {
        console.warn(
          `[agentforge] Could not inspect ${path} during reset.`,
          error instanceof Error ? error.message : error,
        );
      }
      continue;
    }
    if (!stats.isFile()) {
      console.warn(`[agentforge] Skipped ${path} during reset: it is not a regular file.`);
      continue;
    }
    try {
      rmSync(path, { force: true });
    } catch (error) {
      console.warn(
        `[agentforge] Could not remove ${path} during reset.`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    removed.push(path);
  }
  return removed;
}

/**
 * Run a pending wipe, if any. Safe to call on every boot: without a marker it does nothing.
 * A malformed marker is deleted rather than guessed at — a wipe is never inferred.
 */
export function applyPendingDataReset(dir: string): ResetOutcome {
  const root = resolve(dir);
  let marker: ResetMarker | null;
  try {
    marker = readMarker(root);
  } catch (error) {
    if (isMissingFile(error)) {
      return { applied: false, removed: [] };
    }
    console.warn(
      "[agentforge] reset-pending.json could not be read; deleting it and keeping your data.",
      error instanceof Error ? error.message : error,
    );
    dropMarker(root);
    return { applied: false, removed: [] };
  }
  if (!marker) {
    console.warn("[agentforge] reset-pending.json was not a valid v1 marker; deleting it and keeping your data.");
    dropMarker(root);
    return { applied: false, removed: [] };
  }

  const wanted = [...marker.entries, ...SQLITE_ENTRIES];
  const removed: string[] = [];
  for (const entry of wanted) {
    if (removed.includes(entry)) {
      continue;
    }
    if (removeEntry(root, entry)) {
      removed.push(entry);
    }
  }
  removed.push(...removeDatabaseElsewhere(root));
  dropMarker(root);
  return { applied: true, removed };
}

/** The marker's own path, for callers that want to show or clear a pending reset. */
export function pendingResetPath(dir: string): string {
  return markerPath(dir);
}

/** True when a wipe is queued for the next boot. */
export function hasPendingDataReset(dir: string): boolean {
  return existsSync(markerPath(dir));
}
