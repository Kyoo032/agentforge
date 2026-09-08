import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Isolation: point the examples dir at a temp folder BEFORE the module is imported. This module
// never opens the database, but keep the data dir away from the operator's desk regardless.
const dataDir = mkdtempSync(path.join(tmpdir(), "agentforge-video-examples-data-"));
const examplesDir = mkdtempSync(path.join(tmpdir(), "agentforge-video-examples-"));
process.env.AGENTFORGE_DATA_DIR = dataDir;
process.env.AGENTFORGE_VIDEO_EXAMPLES_DIR = examplesDir;
process.env.AGENTFORGE_RUNTIME = "stub";
delete process.env.AGENTFORGE_SETTINGS_PATH;
delete process.env.DATABASE_URL;
delete process.env.MEDIA_ROOT;

const FAKE_BYTES = "fake-mp4-bytes";

describe("bundled video examples (offline)", () => {
  let names: string[] = [];
  let present: string;
  let absent: string;

  beforeAll(async () => {
    const { videoExampleFileNames } = await import("@agentforge/core/edit");
    names = videoExampleFileNames();
    present = names[0] as string;
    absent = names[names.length - 1] as string;
    expect(names.length).toBeGreaterThanOrEqual(2);
    writeFileSync(path.join(examplesDir, present), FAKE_BYTES);
    mkdirSync(path.join(examplesDir, "a-folder.mp4"));
  });

  it("resolves the examples dir from the env override", async () => {
    const { videoExamplesDir } = await import("./video-examples");
    expect(videoExamplesDir()).toBe(path.resolve(examplesDir));
  });

  it("lists only manifest clips that exist on disk, with the template prompt attached", async () => {
    const { listVideoExamples, videoExampleUrl } = await import("./video-examples");
    const items = listVideoExamples();
    expect(items.map((item) => item.file)).toEqual([present]);
    const [item] = items;
    expect(item?.url).toBe(videoExampleUrl(present));
    expect(item?.url).toBe(`/api/v1/videos/examples/${present}/file`);
    expect(item?.title.length).toBeGreaterThan(0);
    expect(item?.prompt.length).toBeGreaterThan(0);
    expect(["16:9", "9:16", "1:1"]).toContain(item?.aspect);
    expect(item?.seconds).toBeGreaterThan(0);
  });

  it("reports why a manifest file cannot be served", async () => {
    const { videoExampleFileProblem } = await import("./video-examples");
    expect(videoExampleFileProblem(examplesDir, present)).toBeNull();
    expect(videoExampleFileProblem(examplesDir, absent)).toBe("missing");
    expect(videoExampleFileProblem(examplesDir, "a-folder.mp4")).toBe("not a file");
  });

  it("reads bytes for a bundled clip and refuses anything outside the manifest", async () => {
    const { readVideoExample } = await import("./video-examples");
    const bytes = await readVideoExample(present);
    expect(bytes).not.toBeNull();
    expect(Buffer.from(bytes as Uint8Array).toString("utf8")).toBe(FAKE_BYTES);
    expect(await readVideoExample(absent)).toBeNull();
    expect(await readVideoExample("../README.md")).toBeNull();
    expect(await readVideoExample("..\\README.md")).toBeNull();
    expect(await readVideoExample("")).toBeNull();
  });

  it("serves the clip through the host routes", async () => {
    const { handleGetVideoExampleFile, handleGetVideoExamples } = await import("./handlers/video-examples");
    const base = { method: "GET", path: "", query: {}, headers: {} };

    const list = await handleGetVideoExamples({ ...base, params: {} });
    expect(list.type).toBe("json");
    if (list.type === "json") {
      expect(list.status).toBe(200);
      expect((list.body as { examples: { file: string }[] }).examples.map((e) => e.file)).toEqual([present]);
    }

    const file = await handleGetVideoExampleFile({ ...base, params: { name: present } });
    expect(file.type).toBe("bytes");
    if (file.type === "bytes") {
      expect(file.status).toBe(200);
      expect(file.contentType).toBe("video/mp4");
      expect(Buffer.from(file.bytes).toString("utf8")).toBe(FAKE_BYTES);
    }

    const missing = await handleGetVideoExampleFile({ ...base, params: { name: absent } });
    expect(missing.type).toBe("json");
    if (missing.type === "json") {
      expect(missing.status).toBe(404);
    }
  });
});
