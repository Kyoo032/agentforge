import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@agentforge/core";
import { runFfmpeg, setExecFileForTests } from "./run";

/** The state of any machine — and every CI runner — with no ffmpeg installed. */
vi.mock("../ffmpeg-binary", () => ({
  resolveFfmpeg: () => ({ found: false, path: null, version: null, reason: "missing" }),
  resolveFfprobe: () => ({ found: false, path: null, version: null, reason: "missing" }),
}));

afterEach(() => {
  setExecFileForTests(null);
});

/**
 * `setExecFileForTests` replaces the thing that spawns the binary, so a suite using it never
 * executes anything — but `spawnFfmpeg` still refused up front when the binary was absent, so the
 * stub was unreachable and the suite quietly depended on the developer's own PATH.
 * `src/edit/import-ipc.test.ts` is the one that failed on every runner without ffmpeg.
 */
describe("runFfmpeg when no binary is installed", () => {
  it("still refuses when nothing has been stubbed, which is the app's real behaviour", async () => {
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).rejects.toThrow(ApiError);
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).rejects.toMatchObject({
      code: "ffmpeg_missing",
    });
  });

  it("runs the stub instead of refusing, so a test needs no ffmpeg on the machine", async () => {
    const calls: string[] = [];
    setExecFileForTests(async (file: string) => {
      calls.push(file);
      return { stdout: "{}", stderr: "" };
    });
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).resolves.toEqual({ stdout: "{}", stderr: "" });
    expect(calls).toEqual(["ffmpeg"]);
  });

  it("names the right binary for an ffprobe call", async () => {
    const calls: string[] = [];
    setExecFileForTests(async (file: string) => {
      calls.push(file);
      return { stdout: "{}", stderr: "" };
    });
    await runFfmpeg(["-show_format"], { timeoutMs: 1000, bin: "ffprobe" });
    expect(calls).toEqual(["ffprobe"]);
  });

  it("goes back to refusing once the stub is taken away", async () => {
    setExecFileForTests(async () => ({ stdout: "", stderr: "" }));
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).resolves.toBeDefined();
    setExecFileForTests(null);
    await expect(runFfmpeg(["-version"], { timeoutMs: 1000 })).rejects.toMatchObject({ code: "ffmpeg_missing" });
  });
});
