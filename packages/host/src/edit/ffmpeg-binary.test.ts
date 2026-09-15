import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEditDoctor, RECHECK_MIN_INTERVAL_MS, resetDoctorRecheckThrottle } from "./doctor";
import { parseFfmpegVersion, resetFfmpegBinaryCache, resolveFfmpeg, resolveFfprobe } from "./ffmpeg-binary";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readdirSync: vi.fn(() => []),
}));

const mockedExec = vi.mocked(execFileSync);
const mockedExists = vi.mocked(existsSync);

function withPlatform(platform: string, run: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", { value: platform, configurable: true });
  try {
    run();
  } finally {
    if (original) {
      Object.defineProperty(process, "platform", original);
    }
  }
}

function versionStdout(version: string): string {
  return `ffmpeg version ${version} Copyright (c) 2000-2023 the FFmpeg developers\n`;
}

/** The PATH lookup, however it is spelled: bare `which` on POSIX, an absolute `where.exe` on win32. */
function isPathLookup(file: unknown): boolean {
  return typeof file === "string" && /(?:^|[\\/])(?:which|where\.exe)$/i.test(file);
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
    mockedExists.mockReset();
    mockedExists.mockReturnValue(false);
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
    mockedExists.mockReturnValue(false);
    mockedExec.mockImplementation(() => {
      throw new Error("not found");
    });
    expect(resolveFfmpeg()).toEqual({ found: false, path: null, version: null, reason: "missing" });
  });

  it("looks PATH up through an absolute where.exe on Windows", () => {
    // Resolving `where` through PATH would let the first `where.exe` on PATH decide where we go
    // looking for ffmpeg — which is the lookup this is meant to secure.
    withPlatform("win32", () => {
      mockedExists.mockReturnValue(false);
      mockedExec.mockImplementation((file) => (isPathLookup(file) ? "C:\\tools\\ffmpeg.exe\n" : versionStdout("7.0")));

      expect(resolveFfmpeg()).toEqual({ found: true, path: "C:\\tools\\ffmpeg.exe", version: "7.0" });
      const lookup = mockedExec.mock.calls.find((call) => isPathLookup(call[0]));
      expect(lookup).toBeDefined();
      expect(String(lookup?.[0])).toMatch(/^[A-Za-z]:\\.*\\System32\\where\.exe$/);
    });
  });

  it("never hands a spawned binary anything but the allowlisted environment", () => {
    // A probe spawns a binary picked up from PATH or a winget directory. It must not carry the
    // wrap key, nor any provider key, in its environment.
    process.env.AGENTFORGE_FFMPEG_PATH = "/opt/ffmpeg/ffmpeg";
    mockedExec.mockReturnValue(versionStdout("6.1.1"));
    resolveFfmpeg();

    for (const call of mockedExec.mock.calls) {
      const env = (call[2] as { env?: NodeJS.ProcessEnv } | undefined)?.env;
      expect(env).toBeDefined();
      for (const key of Object.keys(env ?? {})) {
        expect(key).not.toMatch(/^(AGENTFORGE_SECRETS_KEY|OPENAI_|ANTHROPIC_|GOOGLE_|ARK_|VOLCENGINE_|FAL_)/i);
      }
    }
  });

  it("falls back to the Homebrew prefix when a Finder-launched app has a bare PATH", () => {
    withPlatform("darwin", () => {
      mockedExists.mockImplementation((candidate) => String(candidate) === "/opt/homebrew/bin/ffmpeg");
      mockedExec.mockImplementation((file) => {
        if (file === "which") {
          throw new Error("ffmpeg not on PATH");
        }
        return versionStdout("7.1");
      });
      expect(resolveFfmpeg()).toEqual({ found: true, path: "/opt/homebrew/bin/ffmpeg", version: "7.1" });
    });
  });

  it("skips a broken well-known candidate and keeps probing the rest", () => {
    withPlatform("darwin", () => {
      mockedExists.mockImplementation((candidate) =>
        String(candidate) === "/opt/homebrew/bin/ffmpeg" || String(candidate) === "/usr/local/bin/ffmpeg",
      );
      mockedExec.mockImplementation((file) => {
        if (file === "which" || file === "/opt/homebrew/bin/ffmpeg") {
          throw new Error("dangling symlink");
        }
        return versionStdout("6.1");
      });
      expect(resolveFfmpeg()).toEqual({ found: true, path: "/usr/local/bin/ffmpeg", version: "6.1" });
    });
  });

  it("falls back to well-known locations when the PATH ffmpeg is too old", () => {
    withPlatform("darwin", () => {
      mockedExists.mockImplementation((candidate) => String(candidate) === "/opt/homebrew/bin/ffmpeg");
      mockedExec.mockImplementation((file) => {
        if (file === "which") {
          return "/usr/bin/ffmpeg\n";
        }
        return file === "/usr/bin/ffmpeg" ? versionStdout("4.4") : versionStdout("7.0");
      });
      expect(resolveFfmpeg()).toEqual({ found: true, path: "/opt/homebrew/bin/ffmpeg", version: "7.0" });
    });
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

  it("adds platform setup guidance when ffmpeg is missing", () => {
    delete process.env.AGENTFORGE_FFMPEG_PATH;
    mockedExists.mockReturnValue(false);
    mockedExec.mockImplementation(() => {
      throw new Error("missing");
    });
    withPlatform("darwin", () => {
      const report = getEditDoctor();
      expect(report.ffmpeg.found).toBe(false);
      expect(report.ffmpeg.setup?.platform).toBe("macos");
      expect(report.ffmpeg.setup?.installCommand).toBe("brew install ffmpeg");
    });
  });

  it("recheck drops the cached probe so a fresh install is seen", () => {
    resetDoctorRecheckThrottle();
    delete process.env.AGENTFORGE_FFMPEG_PATH;
    mockedExists.mockReturnValue(false);
    mockedExec.mockImplementation(() => {
      throw new Error("missing");
    });
    expect(getEditDoctor().ffmpeg.found).toBe(false);
    mockedExec.mockReset();
    mockedExec.mockImplementation((file) => (isPathLookup(file) ? "/usr/local/bin/ffmpeg\n" : versionStdout("7.0")));
    expect(getEditDoctor().ffmpeg.found).toBe(false);
    expect(getEditDoctor({ recheck: true }).ffmpeg.found).toBe(true);
  });

  it("throttles back-to-back rechecks so a local page cannot hammer the probe", () => {
    delete process.env.AGENTFORGE_FFMPEG_PATH;
    mockedExists.mockReturnValue(false);
    mockedExec.mockImplementation(() => {
      throw new Error("missing");
    });
    resetDoctorRecheckThrottle();
    expect(getEditDoctor({ recheck: true }, 10_000).ffmpeg.found).toBe(false);
    const probesAfterFirst = mockedExec.mock.calls.length;
    mockedExec.mockImplementation((file) => (isPathLookup(file) ? "/usr/local/bin/ffmpeg\n" : versionStdout("7.0")));
    expect(getEditDoctor({ recheck: true }, 10_000 + RECHECK_MIN_INTERVAL_MS - 1).ffmpeg.found).toBe(false);
    expect(mockedExec.mock.calls.length).toBe(probesAfterFirst);
    expect(getEditDoctor({ recheck: true }, 10_000 + RECHECK_MIN_INTERVAL_MS).ffmpeg.found).toBe(true);
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
