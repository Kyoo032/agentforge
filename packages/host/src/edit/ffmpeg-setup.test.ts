import { describe, expect, it } from "vitest";
import { ffmpegSetupHint } from "./ffmpeg-setup";

describe("ffmpegSetupHint", () => {
  it("points macOS users at Homebrew and explains the Finder PATH gap", () => {
    const hint = ffmpegSetupHint("darwin", "missing");
    expect(hint.platform).toBe("macos");
    expect(hint.installCommand).toBe("brew install ffmpeg");
    expect(hint.installUrl).toBe("https://brew.sh");
    expect(hint.summary).toMatch(/ffmpeg was not found/i);
    expect(hint.steps.join(" ")).toMatch(/Check again/);
    expect(hint.envVar).toBe("AGENTFORGE_FFMPEG_PATH");
  });

  it("points Windows users at winget", () => {
    const hint = ffmpegSetupHint("win32", "missing");
    expect(hint.platform).toBe("windows");
    expect(hint.installCommand).toBe("winget install --id Gyan.FFmpeg -e");
    expect(hint.installUrl).toBe("https://ffmpeg.org/download.html#build-windows");
  });

  it("points Linux users at apt", () => {
    const hint = ffmpegSetupHint("linux", "missing");
    expect(hint.platform).toBe("linux");
    expect(hint.installCommand).toBe("sudo apt install ffmpeg");
  });

  it("explains an outdated build instead of a missing one", () => {
    const hint = ffmpegSetupHint("darwin", "version_below_6");
    expect(hint.summary).toMatch(/older than 6/i);
    expect(hint.installCommand).toBe("brew upgrade ffmpeg");
  });

  it("explains a binary that could not run", () => {
    const hint = ffmpegSetupHint("win32", "exec_failed");
    expect(hint.summary).toMatch(/could not run/i);
  });
});
