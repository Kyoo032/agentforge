import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyPendingDataReset, RESET_MARKER_FILE, requestDataReset } from "./reset";

let dir: string;

function touch(relative: string, body = "x"): string {
  const path = join(dir, relative);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, body, "utf8");
  return path;
}

function readMarker(): { version: number; requestedAt: string; entries: string[] } {
  return JSON.parse(readFileSync(join(dir, RESET_MARKER_FILE), "utf8")) as {
    version: number;
    requestedAt: string;
    entries: string[];
  };
}

const realDataDir = process.env.AGENTFORGE_DATA_DIR;
const realDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "agentforge-reset-"));
  // The sqlite trio is removed by absolute path when DATABASE_URL points outside the data dir, and
  // that only happens for a wipe of *this* desk. Both halves are pinned at the scratch folder so no
  // test can reach the operator's real database.
  process.env.AGENTFORGE_DATA_DIR = dir;
  delete process.env.DATABASE_URL;
});

afterEach(() => {
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

describe("requestDataReset", () => {
  it("writes a versioned marker with the requested entries", () => {
    requestDataReset(dir, ["settings.enc", "media"]);
    const marker = readMarker();
    expect(marker.version).toBe(1);
    expect(marker.entries).toEqual(["settings.enc", "media"]);
    expect(Number.isNaN(Date.parse(marker.requestedAt))).toBe(false);
  });

  it("rejects entries that could escape the data dir", () => {
    for (const bad of ["", "   ", "..", "../evil", "media/../../evil", "/etc/passwd", "\\windows", "C:\\windows"]) {
      expect(() => requestDataReset(dir, [bad])).toThrow(/reset entry/i);
    }
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
  });
});

describe("applyPendingDataReset", () => {
  it("is a no-op when no marker is pending", () => {
    touch("agentforge.sqlite");
    const result = applyPendingDataReset(dir);
    expect(result).toEqual({ applied: false, removed: [] });
    expect(existsSync(join(dir, "agentforge.sqlite"))).toBe(true);
  });

  it("removes the listed entries plus the sqlite trio and keeps everything else", () => {
    touch("settings.enc");
    touch("media/clip.mp4");
    touch("agentforge.sqlite");
    touch("agentforge.sqlite-wal");
    touch("agentforge.sqlite-shm");
    // Chromium / Electron owns these; a wipe must never touch them.
    touch("Local Storage/leveldb/000003.log");
    touch("host-status.json");

    requestDataReset(dir, ["settings.enc", "media"]);
    const result = applyPendingDataReset(dir);

    expect(result.applied).toBe(true);
    expect(result.removed).toEqual(
      expect.arrayContaining([
        "settings.enc",
        "media",
        "agentforge.sqlite",
        "agentforge.sqlite-wal",
        "agentforge.sqlite-shm",
      ]),
    );
    expect(existsSync(join(dir, "settings.enc"))).toBe(false);
    expect(existsSync(join(dir, "media"))).toBe(false);
    expect(existsSync(join(dir, "agentforge.sqlite"))).toBe(false);
    expect(existsSync(join(dir, "agentforge.sqlite-wal"))).toBe(false);
    expect(existsSync(join(dir, "agentforge.sqlite-shm"))).toBe(false);
    expect(existsSync(join(dir, "Local Storage/leveldb/000003.log"))).toBe(true);
    expect(existsSync(join(dir, "host-status.json"))).toBe(true);
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
  });

  it("never throws when a listed entry is already gone", () => {
    requestDataReset(dir, ["settings.enc", "datasets"]);
    const result = applyPendingDataReset(dir);
    expect(result.applied).toBe(true);
    expect(result.removed).toEqual([]);
  });

  it("deletes a malformed marker without wiping anything", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    touch("settings.enc");
    touch("agentforge.sqlite");
    writeFileSync(join(dir, RESET_MARKER_FILE), "{not json", "utf8");

    const result = applyPendingDataReset(dir);

    expect(result).toEqual({ applied: false, removed: [] });
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
    expect(existsSync(join(dir, "settings.enc"))).toBe(true);
    expect(existsSync(join(dir, "agentforge.sqlite"))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("skips entries that escape the dir but still clears the marker", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const outside = touch("../agentforge-reset-outside.txt");
    touch("settings.enc");
    // Hand-edited / tampered marker: requestDataReset would never write these.
    writeFileSync(
      join(dir, RESET_MARKER_FILE),
      JSON.stringify({
        version: 1,
        requestedAt: new Date().toISOString(),
        entries: ["../agentforge-reset-outside.txt", "settings.enc"],
      }),
      "utf8",
    );

    const result = applyPendingDataReset(dir);

    expect(result.applied).toBe(true);
    expect(result.removed).toEqual(["settings.enc"]);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(false);
    rmSync(outside, { force: true });
    warn.mockRestore();
  });
});

describe("applyPendingDataReset with a database elsewhere", () => {
  it("removes the sqlite trio at the DATABASE_URL path, outside the data dir", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-reset-db-"));
    const base = join(elsewhere, "elsewhere.sqlite");
    process.env.DATABASE_URL = `file:${base}`;
    writeFileSync(base, "x", "utf8");
    writeFileSync(`${base}-wal`, "x", "utf8");
    writeFileSync(`${base}-shm`, "x", "utf8");
    // A neighbour in the same folder proves only the trio goes.
    writeFileSync(join(elsewhere, "keep.txt"), "x", "utf8");

    requestDataReset(dir, ["settings.enc"]);
    const result = applyPendingDataReset(dir);

    expect(result.applied).toBe(true);
    expect(result.removed).toEqual(expect.arrayContaining([base, `${base}-wal`, `${base}-shm`]));
    expect(existsSync(base)).toBe(false);
    expect(existsSync(`${base}-wal`)).toBe(false);
    expect(existsSync(`${base}-shm`)).toBe(false);
    expect(existsSync(join(elsewhere, "keep.txt"))).toBe(true);
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("leaves a database that already lives inside the data dir to the relative entries", () => {
    process.env.DATABASE_URL = `file:${join(dir, "agentforge.sqlite")}`;
    touch("agentforge.sqlite");

    requestDataReset(dir, ["settings.enc"]);
    const result = applyPendingDataReset(dir);

    // Removed once, under its relative name, never a second time by absolute path.
    expect(result.removed).toEqual(["agentforge.sqlite"]);
    expect(existsSync(join(dir, "agentforge.sqlite"))).toBe(false);
  });

  it("leaves a directory sitting at the sqlite path alone", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-reset-dbdir-"));
    const base = join(elsewhere, "elsewhere.sqlite");
    process.env.DATABASE_URL = `file:${base}`;
    // Someone (or something) put a directory where the database file belongs: a recursive wipe here
    // would take everything under it, so the reset must decline instead.
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "inside.txt"), "x", "utf8");

    requestDataReset(dir, ["settings.enc"]);
    const result = applyPendingDataReset(dir);

    expect(result.applied).toBe(true);
    expect(result.removed).not.toContain(base);
    expect(existsSync(base)).toBe(true);
    expect(existsSync(join(base, "inside.txt"))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("removes the -wal and -shm files even when a directory blocks the sqlite path", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-reset-dbdir-wal-"));
    const base = join(elsewhere, "elsewhere.sqlite");
    process.env.DATABASE_URL = `file:${base}`;
    mkdirSync(base, { recursive: true });
    writeFileSync(`${base}-wal`, "x", "utf8");
    writeFileSync(`${base}-shm`, "x", "utf8");

    requestDataReset(dir, ["settings.enc"]);
    const result = applyPendingDataReset(dir);

    expect(result.removed).toEqual(expect.arrayContaining([`${base}-wal`, `${base}-shm`]));
    expect(result.removed).not.toContain(base);
    expect(existsSync(base)).toBe(true);
    expect(existsSync(`${base}-wal`)).toBe(false);
    warn.mockRestore();
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("leaves a symlink parked at the sqlite path, and its target, alone", () => {
    const elsewhere = mkdtempSync(join(tmpdir(), "agentforge-reset-dblink-"));
    const target = join(elsewhere, "real-notes.txt");
    const base = join(elsewhere, "elsewhere.sqlite");
    writeFileSync(target, "x", "utf8");
    let linked = true;
    try {
      // Needs Developer Mode or elevation on Windows; the rule is still worth asserting where it works.
      symlinkSync(target, base, "file");
    } catch {
      linked = false;
    }
    if (!linked) {
      rmSync(elsewhere, { recursive: true, force: true });
      return;
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    process.env.DATABASE_URL = `file:${base}`;
    requestDataReset(dir, ["settings.enc"]);
    const result = applyPendingDataReset(dir);

    expect(result.removed).not.toContain(base);
    expect(existsSync(target)).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    rmSync(elsewhere, { recursive: true, force: true });
  });

  it("never touches another directory's database", () => {
    const other = mkdtempSync(join(tmpdir(), "agentforge-reset-other-"));
    const base = join(other, "other.sqlite");
    process.env.DATABASE_URL = `file:${base}`;
    process.env.AGENTFORGE_DATA_DIR = other;
    writeFileSync(base, "x", "utf8");

    // `dir` is not this desk's data dir, so the configured database is none of its business.
    requestDataReset(dir, ["settings.enc"]);
    applyPendingDataReset(dir);

    expect(existsSync(base)).toBe(true);
    rmSync(other, { recursive: true, force: true });
  });
});

describe("applyPendingDataReset symlink defense", () => {
  it("wipes a plain directory entry", () => {
    touch("media/clip.mp4");
    requestDataReset(dir, ["media"]);

    const result = applyPendingDataReset(dir);

    expect(result.removed).toContain("media");
    expect(existsSync(join(dir, "media"))).toBe(false);
  });

  it("skips an entry whose parent links outside the data dir, and keeps the target", () => {
    const outside = mkdtempSync(join(tmpdir(), "agentforge-reset-link-"));
    writeFileSync(join(outside, "clip.mp4"), "x", "utf8");
    let linked = true;
    try {
      // Needs Developer Mode or elevation on Windows; the rule is still worth asserting where it works.
      symlinkSync(outside, join(dir, "media"), "junction");
    } catch {
      linked = false;
    }
    if (!linked) {
      rmSync(outside, { recursive: true, force: true });
      return;
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    requestDataReset(dir, ["media/clip.mp4"]);
    const result = applyPendingDataReset(dir);

    expect(result.removed).not.toContain("media/clip.mp4");
    expect(existsSync(join(outside, "clip.mp4"))).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    rmSync(join(dir, "media"), { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  });
});

describe("requestDataReset atomicity", () => {
  it("leaves no .tmp file behind", () => {
    requestDataReset(dir, ["settings.enc"]);
    expect(existsSync(join(dir, `${RESET_MARKER_FILE}.tmp`))).toBe(false);
    expect(existsSync(join(dir, RESET_MARKER_FILE))).toBe(true);
  });
});
