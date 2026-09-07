import { existsSync, mkdirSync, mkdtempSync, readdirSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Isolation: this file points the SQLite data dir, media root, and starter media dir at
// temp folders BEFORE any host module is imported, so nothing touches the operator's desk.
const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-starter-data-"));
const startersDir = mkdtempSync(path.join(tmpdir(), "agentforge-starters-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_STARTER_MEDIA_DIR = startersDir;
process.env.AGENTFORGE_FFMPEG_PATH = path.join(startersDir, "no-such-ffmpeg.exe");
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.MEDIA_ROOT;

const PROMO_FILES = ["promo-skyline-16x9.mp4", "promo-detail-16x9.mp4", "promo-motion-16x9.mp4", "music-bed-18s.m4a"];

describe("starter media seeding (offline)", () => {
  // First import opens a fresh SQLite and runs every migration; give it room on cold disks.
  beforeAll(async () => {
    for (const name of PROMO_FILES) {
      writeFileSync(path.join(startersDir, name), `fake-${name}`);
    }
    await import("./projects");
  }, 60_000);

  it("resolves the starter dir from the env override", async () => {
    const { starterMediaDir } = await import("./starter-media");
    expect(starterMediaDir()).toBe(path.resolve(startersDir));
  });

  it("lays bundled clips on v1 after the title and the music bed on a1", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Promo", starterId: "promo-16x9" });

    const v1 = doc.clips.filter((clip) => clip.trackId === "v1").sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
    const a1 = doc.clips.filter((clip) => clip.trackId === "a1");
    expect(v1).toHaveLength(4);
    expect(v1[0]?.title?.text).toBe("Title");
    expect(v1[0]?.durationFrames).toBe(doc.fps * 3);
    for (let i = 1; i < v1.length; i += 1) {
      const prev = v1[i - 1];
      const current = v1[i];
      expect(prev).toBeDefined();
      expect(current).toBeDefined();
      if (!prev || !current) {
        continue;
      }
      expect(current.timelineStartFrame).toBe(prev.timelineStartFrame + prev.durationFrames);
      expect(current.durationFrames).toBe(6 * 30);
      expect(current.source?.assetId).toBeDefined();
    }
    expect(a1).toHaveLength(1);
    expect(a1[0]?.timelineStartFrame).toBe(0);
    expect(a1[0]?.durationFrames).toBe(18 * 30);

    const assets = Object.values(doc.assets);
    expect(assets).toHaveLength(4);
    for (const asset of assets) {
      expect(asset.mediaId).toBeDefined();
      expect(asset.storagePath.startsWith(`${tenant.organizationId}/`)).toBe(true);
      expect(existsSync(path.join(dataDir, "media", asset.storagePath))).toBe(true);
    }
    expect(readdirSync(path.join(dataDir, "media", tenant.organizationId))).toHaveLength(4);
  });

  it("skips missing files but still creates the project", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Reel", starterId: "reels-9x16" });
    expect(doc.width).toBe(1080);
    expect(doc.height).toBe(1920);
    const v1 = doc.clips.filter((clip) => clip.trackId === "v1");
    expect(v1).toHaveLength(1);
    expect(v1[0]?.title?.text).toBe("Title");
    expect(Object.keys(doc.assets)).toHaveLength(0);
  });

  it("rejects a symlink, a directory, and an oversized file in the starter dir", async () => {
    const { starterFileProblem, STARTER_MEDIA_MAX_BYTES } = await import("./starter-media");
    const dir = mkdtempSync(path.join(tmpdir(), "agentforge-starter-bad-"));
    const secret = path.join(dir, "secret.txt");
    writeFileSync(secret, "top secret");
    let symlinkOk = true;
    try {
      symlinkSync(secret, path.join(dir, "reel-10s-9x16.mp4"));
    } catch {
      symlinkOk = false; // Windows without symlink privilege
    }
    if (symlinkOk) {
      expect(starterFileProblem(dir, "reel-10s-9x16.mp4")).toBe("symlink");
    }
    mkdirSync(path.join(dir, "square-8s-1x1.mp4"));
    expect(starterFileProblem(dir, "square-8s-1x1.mp4")).toBe("not a file");
    expect(starterFileProblem(dir, "talk-20s-16x9.mp4")).toBe("missing");
    writeFileSync(path.join(dir, "promo-skyline-16x9.mp4"), "ok");
    expect(starterFileProblem(dir, "promo-skyline-16x9.mp4")).toBeNull();
    expect(STARTER_MEDIA_MAX_BYTES).toBeGreaterThan(0);
  });

  it("blank starters stay empty", async () => {
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Blank", starterId: "blank-1x1" });
    expect(doc.clips).toHaveLength(0);
    expect(Object.keys(doc.assets)).toHaveLength(0);
  });
});
