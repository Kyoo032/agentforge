import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Isolation: separate SQLite + media root in temp. Uses the REAL generated starter files
// and the machine's ffprobe. Skips cleanly when either is absent (CI without ffmpeg).
const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-starter-probe-"));
const repoStarters = path.resolve(__dirname, "../../../../apps/desktop/resources/starters");
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_STARTER_MEDIA_DIR = repoStarters;
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_FFMPEG_PATH;
delete process.env.AGENTFORGE_FFPROBE_PATH;
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.MEDIA_ROOT;

const talkFile = path.join(repoStarters, "talk-20s-16x9.mp4");

describe("starter media seeding with real files and ffprobe", () => {
  let ffmpegFound = false;

  beforeAll(async () => {
    const { resolveFfmpeg } = await import("./ffmpeg-binary");
    ffmpegFound = resolveFfmpeg().found;
    await import("./projects");
  }, 60_000);

  it("probes the bundled talk clip and lays it at the real duration", async () => {
    if (!ffmpegFound || !existsSync(talkFile)) {
      console.warn("skipping: ffmpeg or generated starters not available");
      return;
    }
    const { createEditProject } = await import("./projects");
    const { getTenant } = await import("../tenant");
    const tenant = await getTenant();
    const doc = await createEditProject(tenant, { name: "Talk", starterId: "talk-16x9" });

    const v1 = doc.clips.filter((clip) => clip.trackId === "v1");
    const c1 = doc.clips.filter((clip) => clip.trackId === "c1");
    expect(v1).toHaveLength(1);
    expect(v1[0]?.durationFrames).toBe(20 * 30);
    expect(c1).toHaveLength(1);
    const asset = Object.values(doc.assets)[0];
    expect(asset?.width).toBe(1280);
    expect(asset?.height).toBe(720);
    expect(asset?.hasAudio).toBe(true);
    expect(asset?.probe?.codec).toBe("h264");
  }, 60_000);
});
