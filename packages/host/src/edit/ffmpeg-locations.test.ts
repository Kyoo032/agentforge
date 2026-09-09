import { describe, expect, it } from "vitest";
import { wellKnownBinaryPaths, wingetPackageBinaryPaths } from "./ffmpeg-locations";

describe("wellKnownBinaryPaths", () => {
  it("lists Homebrew (arm64 + intel) and MacPorts on macOS", () => {
    const paths = wellKnownBinaryPaths("ffmpeg", { platform: "darwin", env: {}, home: "/Users/kyoo" });
    expect(paths).toEqual([
      "/opt/homebrew/bin/ffmpeg",
      "/usr/local/bin/ffmpeg",
      "/opt/local/bin/ffmpeg",
      "/Users/kyoo/.local/bin/ffmpeg",
    ]);
  });

  it("lists winget links, chocolatey, scoop and C:\\ffmpeg on Windows with the exe suffix", () => {
    const paths = wellKnownBinaryPaths("ffprobe", {
      platform: "win32",
      env: { LOCALAPPDATA: "C:\\Users\\kyoo\\AppData\\Local", ProgramData: "C:\\ProgramData" },
      home: "C:\\Users\\kyoo",
    });
    expect(paths).toEqual([
      "C:\\Users\\kyoo\\AppData\\Local\\Microsoft\\WinGet\\Links\\ffprobe.exe",
      "C:\\ProgramData\\chocolatey\\bin\\ffprobe.exe",
      "C:\\Users\\kyoo\\scoop\\shims\\ffprobe.exe",
      "C:\\ffmpeg\\bin\\ffprobe.exe",
    ]);
  });

  it("skips Windows entries whose env root is missing", () => {
    const paths = wellKnownBinaryPaths("ffmpeg", { platform: "win32", env: {}, home: "C:\\Users\\kyoo" });
    expect(paths).toEqual(["C:\\Users\\kyoo\\scoop\\shims\\ffmpeg.exe", "C:\\ffmpeg\\bin\\ffmpeg.exe"]);
  });

  it("lists the usual prefixes on Linux", () => {
    const paths = wellKnownBinaryPaths("ffmpeg", { platform: "linux", env: {}, home: "/home/kyoo" });
    expect(paths).toEqual(["/usr/local/bin/ffmpeg", "/usr/bin/ffmpeg", "/snap/bin/ffmpeg", "/home/kyoo/.local/bin/ffmpeg"]);
  });
});

describe("wingetPackageBinaryPaths", () => {
  const ctx = { platform: "win32", env: { LOCALAPPDATA: "C:\\Users\\kyoo\\AppData\\Local" }, home: "C:\\Users\\kyoo" };
  const packages = "C:\\Users\\kyoo\\AppData\\Local\\Microsoft\\WinGet\\Packages";
  const pkg = "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe";

  it("finds the newest Gyan.FFmpeg build under the winget packages dir", () => {
    const listDir = (dir: string): string[] => {
      if (dir === packages) {
        return [pkg, "Other.Tool_x"];
      }
      if (dir === `${packages}\\${pkg}`) {
        return ["ffmpeg-7.1-full_build", "ffmpeg-8.1.1-full_build"];
      }
      return [];
    };
    expect(wingetPackageBinaryPaths("ffmpeg", ctx, listDir)).toEqual([
      `${packages}\\${pkg}\\ffmpeg-8.1.1-full_build\\bin\\ffmpeg.exe`,
      `${packages}\\${pkg}\\ffmpeg-7.1-full_build\\bin\\ffmpeg.exe`,
    ]);
  });

  it("orders builds by numeric version, not by string", () => {
    const listDir = (dir: string): string[] => {
      if (dir === packages) {
        return [pkg];
      }
      if (dir === `${packages}\\${pkg}`) {
        return ["ffmpeg-9.0.2-full_build", "ffmpeg-10.0-full_build", "ffmpeg-9.1-full_build"];
      }
      return [];
    };
    expect(wingetPackageBinaryPaths("ffmpeg", ctx, listDir).map((item) => item.split("\\").at(-3))).toEqual([
      "ffmpeg-10.0-full_build",
      "ffmpeg-9.1-full_build",
      "ffmpeg-9.0.2-full_build",
    ]);
  });

  it("returns nothing off Windows or when LOCALAPPDATA is unset", () => {
    expect(wingetPackageBinaryPaths("ffmpeg", { ...ctx, platform: "darwin" }, () => ["x"])).toEqual([]);
    expect(wingetPackageBinaryPaths("ffmpeg", { ...ctx, env: {} }, () => ["x"])).toEqual([]);
  });
});
