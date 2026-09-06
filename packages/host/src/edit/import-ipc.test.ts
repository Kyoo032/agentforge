import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatch } from "../router";
import { seedEditProject } from "./harness";
import { setExecFileForTests } from "./ffmpeg/run";

describe("import over ipc (G-15)", () => {
  afterEach(() => {
    setExecFileForTests(null);
  });

  it("accepts sourcePath when the transport header is ipc", async () => {
    const { project } = await seedEditProject("import-ipc");
    const dir = mkdtempSync(path.join(tmpdir(), "edit-src-"));
    const file = path.join(dir, "clip.mp4");
    writeFileSync(file, "not-a-real-mp4");
    setExecFileForTests(async () => ({
      stdout: JSON.stringify({
        streams: [{ codec_type: "video", width: 1280, height: 720, avg_frame_rate: "30/1", codec_name: "h264" }],
        format: { duration: "1.0" },
      }),
      stderr: "",
    }));
    const result = await dispatch({
      method: "POST",
      path: `/api/v1/edit/projects/${project.id}/import`,
      query: {},
      params: {},
      headers: { "x-agentforge-transport": "ipc" },
      body: { sourcePath: file },
    });
    expect(result.type).toBe("json");
    if (result.type === "json") {
      expect(result.status).toBe(201);
    }
  });
});
