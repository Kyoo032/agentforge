/**
 * "Start over" when a removal fails.
 *
 * On Windows a file another process holds open (a virus scanner, a second copy of the app) refuses
 * to be deleted. `rmSync` refuses the same way here, for the names a test locks, so the retry rules
 * can be pinned without a real lock. Everything else goes to the real filesystem.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPendingDataReset, RESET_MARKER_FILE, requestDataReset, resetOutcomeSummary } from "./reset";

const locked = vi.hoisted(() => new Set<string>());

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    rmSync: (path: Parameters<typeof actual.rmSync>[0], options?: Parameters<typeof actual.rmSync>[1]) => {
      if (locked.has(basename(String(path)))) {
        // Node's own message carries the absolute path, which is exactly what must not reach a log.
        throw Object.assign(new Error(`EBUSY: resource busy or locked, unlink '${String(path)}'`), {
          code: "EBUSY",
        });
      }
      actual.rmSync(path, options);
    },
  };
});

let dir: string;

function touch(relative: string): void {
  const path = join(dir, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "x", "utf8");
}

function pendingMarker(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, RESET_MARKER_FILE), "utf8")) as Record<string, unknown>;
}

const realDataDir = process.env.AGENTFORGE_DATA_DIR;
const realDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentforge-reset-retry-"));
  // Both halves pinned at the scratch folder so no test can reach the operator's real database.
  process.env.AGENTFORGE_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  locked.clear();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  if (realDataDir === undefined) {
    delete process.env.AGENTFORGE_DATA_DIR;
  } else {
    process.env.AGENTFORGE_DATA_DIR = realDataDir;
  }
  if (realDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = realDatabaseUrl;
  }
});

describe("applyPendingDataReset when a removal fails", () => {
  it("keeps the marker, names only what is left, and does not report the wipe as applied", () => {
    touch("settings.enc");
    touch("media/clip.mp4");
    touch("agentforge.sqlite");
    requestDataReset(dir, ["settings.enc", "media"]);
    locked.add("media");

    const result = applyPendingDataReset(dir);

    expect(result.applied).toBe(false);
    expect(result.failed).toEqual(["media"]);
    expect(result.removed).toEqual(expect.arrayContaining(["settings.enc", "agentforge.sqlite"]));
    expect(existsSync(join(dir, "settings.enc"))).toBe(false);
    expect(existsSync(join(dir, "media", "clip.mp4"))).toBe(true);
    // Still pending, for what is left only: the database already went.
    expect(pendingMarker()).toMatchObject({ version: 1, entries: ["media"], database: false });
  });

  it("retries only what was left on the next boot, never what the app wrote since", () => {
    touch("settings.enc");
    touch("media/clip.mp4");
    touch("agentforge.sqlite");
    requestDataReset(dir, ["settings.enc", "media"]);
    locked.add("media");
    applyPendingDataReset(dir);
    locked.clear();
    // Between the two boots the app opened a fresh database and the owner saved a key again.
    touch("agentforge.sqlite");
    touch("settings.enc");

    const retry = applyPendingDataReset(dir);

    expect(retry).toEqual({ applied: true, removed: ["media"], failed: [] });
    expect(existsSync(join(dir, "media"))).toBe(false);
    expect(existsSync(join(dir, "agentforge.sqlite"))).toBe(true);
    expect(existsSync(join(dir, "settings.enc"))).toBe(true);
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
  });

  it("retries the whole database when part of it could not be removed", () => {
    touch("agentforge.sqlite");
    touch("agentforge.sqlite-wal");
    touch("agentforge.sqlite-shm");
    requestDataReset(dir, ["settings.enc"]);
    locked.add("agentforge.sqlite-wal");

    const first = applyPendingDataReset(dir);

    expect(first.applied).toBe(false);
    expect(first.failed).toEqual(["agentforge.sqlite-wal"]);
    expect(pendingMarker()).toMatchObject({ entries: [], database: true });

    locked.clear();
    const retry = applyPendingDataReset(dir);

    expect(retry).toEqual({ applied: true, removed: ["agentforge.sqlite-wal"], failed: [] });
    expect(existsSync(join(dir, "agentforge.sqlite-wal"))).toBe(false);
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
  });

  it("keeps the marker when a database outside the data dir could not be removed", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-reset-retry-db-"));
    try {
      const base = join(elsewhere, "elsewhere.sqlite");
      process.env.DATABASE_URL = `file:${base}`;
      writeFileSync(base, "x", "utf8");
      requestDataReset(dir, ["settings.enc"]);
      locked.add("elsewhere.sqlite");

      const first = applyPendingDataReset(dir);

      expect(first.applied).toBe(false);
      expect(first.failed).toEqual([base]);
      expect(existsSync(base)).toBe(true);
      expect(pendingMarker()).toMatchObject({ entries: [], database: true });

      locked.clear();
      const retry = applyPendingDataReset(dir);

      expect(retry.applied).toBe(true);
      expect(retry.removed).toEqual([base]);
      expect(existsSync(base)).toBe(false);
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it("says which entry it could not remove, and why, without the path of the file", () => {
    touch("settings.enc");
    requestDataReset(dir, ["settings.enc"]);
    locked.add("settings.enc");

    applyPendingDataReset(dir);

    const logged = vi
      .mocked(console.warn)
      .mock.calls.flat()
      .map((part) => String(part))
      .join("\n");
    expect(logged).toContain("settings.enc");
    expect(logged).toContain("EBUSY");
    // The scratch folder's own name is in every spelling of the path (short, long, real).
    expect(logged).not.toContain(basename(dir));
  });
});

describe("resetOutcomeSummary", () => {
  it("says nothing when no wipe was pending", () => {
    expect(resetOutcomeSummary({ applied: false, removed: [], failed: [] })).toBeNull();
  });

  it("counts what went and what is left for the next launch, and names no file or path", () => {
    const done = resetOutcomeSummary({
      applied: true,
      removed: ["settings.enc", ".master-key", "D:/elsewhere/agentforge.sqlite"],
      failed: [],
    });
    const partial = resetOutcomeSummary({
      applied: false,
      removed: [".master-key"],
      failed: ["settings.enc", "C:\\elsewhere\\agentforge.sqlite"],
    });

    expect(done).toMatch(/applied/i);
    expect(done).toContain("3");
    expect(partial).toMatch(/next launch/i);
    expect(partial).toContain("1");
    expect(partial).toContain("2");
    for (const line of [done, partial]) {
      expect(line).not.toMatch(/settings\.enc|master-key|agentforge\.sqlite|elsewhere/);
    }
  });
});
