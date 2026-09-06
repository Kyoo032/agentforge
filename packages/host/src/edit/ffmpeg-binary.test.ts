import { execFileSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEditDoctor } from "./doctor";
import { parseFfmpegVersion, resetFfmpegBinaryCache, resolveFfmpeg, resolveFfprobe } from "./ffmpeg-binary";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExec = vi.mocked(execFileSync);

function versionStdout(version: string): string {
  return `ffmpeg version ${version} Copyright (c) 2000-2023 the FFmpeg developers\n`;
}

describe("parseFfmpegVersion", () => {
  it("reads major.minor.patch from ffmpeg -version", () => {
    expect(parseFfmpegVersion(versionStdout("6.1.1-3ubuntu5"))).toEqual({ version: "6.1.1", major: 6 });
    expect(parseFfmpegVersion("ffprobe version n6.1.1 Copyright")).toEqual({ version: "6.1.1", major: 6 });
    expect(parseFfmpegVersion(versionStdout("8.1.1-full_build"))).toEqual({ version: "8.1.1", major: 8 });
    expect(parseFfmpegVersion(versionStdout("4.4.2"))).toEqual({ version: "4.4.2", major: 4 });
  });

  it("returns null when the banner has no version", () => {
    expect(parseFfmpegVersion("not a version banner")).toBeNull();
  });
});

describe("resolveFfmpeg", () => {
  const prevFfmpeg = process.env.AGENTFORGE_FFMPEG_PATH;
  const prevFfprobe = process.env.AGENTFORGE_FFPROBE_PATH;
  const prevAsr = process.env.AGENTFORGE_EDIT_ASR_MODEL;

  beforeEach(() => {
    resetFfmpegBinaryCache();
    mockedExec.mockReset();
    delete process.env.AGENTFORGE_FFMPEG_PATH;
    delete process.env.AGENTFORGE_FFPROBE_PATH;
    delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
  });

  afterEach(() => {
    resetFfmpegBinaryCache();
    if (prevFfmpeg === undefined) {
      delete process.env.AGENTFORGE_FFMPEG_PATH;
    } else {
      process.env.AGENTFORGE_FFMPEG_PATH = prevFfmpeg;
    }
    if (prevFfprobe === undefined) {
      delete process.env.AGENTFORGE_FFPROBE_PATH;
    } else {
      process.env.AGENTFORGE_FFPROBE_PATH = prevFfprobe;
    }
    if (prevAsr === undefined) {
      delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
    } else {
      process.env.AGENTFORGE_EDIT_ASR_MODEL = prevAsr;
    }
  });

  it("uses AGENTFORGE_FFMPEG_PATH and accepts major >= 6", () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    mockedExec.mockReturnValue(versionStdout("6.1.1"));
    const result = resolveFfmpeg();
    expect(result).toEqual({ found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" });
    expect(mockedExec).toHaveBeenCalledWith(
      "/opt/ffmpeg/ffmpeg",
      ["-version"],
      expect.objectContaining({ encoding: "utf8" }),
    );
  });

  it("reports found:false with reason when the binary is older than 6", () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/old/ffmpeg";
    mockedExec.mockReturnValue(versionStdout("5.1.2"));
    expect(resolveFfmpeg()).toEqual({
      found: false,
      path: "/opt/old/ffmpeg",
      version: "5.1.2",
      reason: "version_below_6",
    });
  });

  it("reports found:false when PATH lookup fails", () => {
    mockedExec.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(resolveFfmpeg()).toEqual({ found: false, path: null, version: null, reason: "missing" });
  });

  it("caches the first probe", () => {
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    mockedExec.mockReturnValue(versionStdout("6.0"));
    resolveFfmpeg();
    resolveFfmpeg();
    expect(mockedExec).toHaveBeenCalledTimes(1);
  });
});

describe("getEditDoctor", () => {
  const prevFfmpeg = process.env.AGENTFORGE_FFMPEG_PATH;
  const prevAsr = process.env.AGENTFORGE_EDIT_ASR_MODEL;

  beforeEach(() => {
    resetFfmpegBinaryCache();
    mockedExec.mockReset();
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
    mockedExec.mockReturnValue(versionStdout("6.1.1"));
  });

  afterEach(() => {
    resetFfmpegBinaryCache();
    if (prevFfmpeg === undefined) {
      delete process.env.AGENTFORGE_FFMPEG_PATH;
    } else {
      process.env.AGENTFORGE_FFMPEG_PATH = prevFfmpeg;
    }
    if (prevAsr === undefined) {
      delete process.env.AGENTFORGE_EDIT_ASR_MODEL;
    } else {
      process.env.AGENTFORGE_EDIT_ASR_MODEL = prevAsr;
    }
  });

  it("returns the Loop 0 doctor payload shape", () => {
    const report = getEditDoctor();
    expect(report).toEqual({
      ffmpeg: { found: true, path: "/opt/ffmpeg/ffmpeg", version: "6.1.1" },
      asr: { available: false, backend: null, model: null },
      fonts: [],
    });
  });

  it("reports ASR when AGENTFORGE_EDIT_ASR_MODEL is set", () => {
    process.env.AGENTFORGE_EDIT_ASR_MODEL = "whisper-1";
    const report = getEditDoctor();
    expect(report.asr).toEqual({ available: true, backend: "gateway", model: "whisper-1" });
    expect(report.fonts).toEqual([]);
  });

  it("resolveFfprobe uses the env path the same way", () => {
    process.env.AGENTFORGE_FFPROBE_PATH = "/opt/ffmpeg/ffprobe";
    mockedExec.mockReturnValue("ffprobe version 6.1.1 Copyright\n");
    expect(resolveFfprobe()).toEqual({ found: true, path: "/opt/ffmpeg/ffprobe", version: "6.1.1" });
  });
});
