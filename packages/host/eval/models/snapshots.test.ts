import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CatalogSnapshot } from "./catalog-report";
import { readLatestSnapshot, snapshotFileName, writeSnapshot } from "./snapshots";

const snap = (generatedAt: string, ids: string[]): CatalogSnapshot => ({
  version: 1,
  generatedAt,
  ids,
  chatIds: ids,
});

let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eval-models-snap-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

describe("snapshotFileName", () => {
  it("is safe on every filesystem and sorts by time", () => {
    const name = snapshotFileName("2026-09-30T10:00:00.000Z");
    expect(name).toBe("catalog-2026-09-30T10-00-00-000Z.json");
    expect(name).not.toMatch(/[:<>"|?*]/);
    expect(snapshotFileName("2026-10-01T00:00:00.000Z") > name).toBe(true);
  });
});

describe("writeSnapshot and readLatestSnapshot", () => {
  it("round-trips the newest snapshot in the folder", () => {
    writeSnapshot(dir, snap("2026-09-29T09:00:00.000Z", ["a"]));
    writeSnapshot(dir, snap("2026-09-30T09:00:00.000Z", ["a", "b"]));
    expect(readLatestSnapshot(dir)?.ids).toEqual(["a", "b"]);
  });

  it("creates the folder, and keeps the report beside the snapshot without letting it change the snapshot", () => {
    const nested = join(dir, "deep", "results");
    const path = writeSnapshot(nested, snap("2026-09-30T09:00:00.000Z", ["a"]), { note: "the full report" });
    const stored = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(stored.report).toEqual({ note: "the full report" });
    expect(readLatestSnapshot(nested)).toEqual(snap("2026-09-30T09:00:00.000Z", ["a"]));
  });

  it("can be told to skip the run it is about to write", () => {
    writeSnapshot(dir, snap("2026-09-29T09:00:00.000Z", ["old"]));
    writeSnapshot(dir, snap("2026-09-30T09:00:00.000Z", ["new"]));
    expect(readLatestSnapshot(dir, { before: "2026-09-30T09:00:00.000Z" })?.ids).toEqual(["old"]);
  });

  it("ignores files that are not snapshots, and snapshots it cannot read", () => {
    writeSnapshot(dir, snap("2026-09-29T09:00:00.000Z", ["good"]));
    writeFileSync(join(dir, "catalog-2026-09-30T09-00-00-000Z.json"), "{ not json");
    writeFileSync(join(dir, "catalog-2026-09-30T10-00-00-000Z.json"), JSON.stringify({ version: 2, ids: "x" }));
    writeFileSync(join(dir, "probe-2026-09-30T11-00-00-000Z.json"), JSON.stringify(snap("2026-09-30T11:00:00.000Z", ["probe"])));
    mkdirSync(join(dir, "catalog-2026-09-30T12-00-00-000Z.json"));
    expect(readLatestSnapshot(dir)?.ids).toEqual(["good"]);
  });

  it("is undefined for a folder that is missing or empty", () => {
    expect(readLatestSnapshot(join(dir, "nope"))).toBeUndefined();
    expect(readLatestSnapshot(dir)).toBeUndefined();
  });

  it("writes exactly one file per snapshot", () => {
    writeSnapshot(dir, snap("2026-09-30T09:00:00.000Z", ["a"]));
    expect(readdirSync(dir)).toEqual(["catalog-2026-09-30T09-00-00-000Z.json"]);
  });
});
