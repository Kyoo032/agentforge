import path from "node:path";

export type BinaryName = "ffmpeg" | "ffprobe";

export type LocationContext = {
  platform: NodeJS.Platform | string;
  env: Record<string, string | undefined>;
  home: string;
};

function fileName(kind: BinaryName, platform: string): string {
  return platform === "win32" ? `${kind}.exe` : kind;
}

/**
 * Places package managers drop ffmpeg that are often NOT on a GUI app's PATH.
 * A Finder-launched Electron app on macOS only sees /usr/bin:/bin:/usr/sbin:/sbin,
 * so Homebrew's prefix has to be probed explicitly.
 */
export function wellKnownBinaryPaths(kind: BinaryName, ctx: LocationContext): string[] {
  const file = fileName(kind, ctx.platform);
  if (ctx.platform === "darwin") {
    return [
      `/opt/homebrew/bin/${file}`,
      `/usr/local/bin/${file}`,
      `/opt/local/bin/${file}`,
      path.posix.join(ctx.home, ".local", "bin", file),
    ];
  }
  if (ctx.platform === "win32") {
    const localAppData = ctx.env.LOCALAPPDATA;
    const programData = ctx.env.ProgramData;
    return [
      localAppData ? path.win32.join(localAppData, "Microsoft", "WinGet", "Links", file) : null,
      programData ? path.win32.join(programData, "chocolatey", "bin", file) : null,
      path.win32.join(ctx.home, "scoop", "shims", file),
      path.win32.join("C:\\ffmpeg", "bin", file),
    ].filter((item): item is string => item !== null);
  }
  return [`/usr/local/bin/${file}`, `/usr/bin/${file}`, `/snap/bin/${file}`, path.posix.join(ctx.home, ".local", "bin", file)];
}

/** Numeric parts of a winget build folder name such as `ffmpeg-8.1.1-full_build`. */
function buildVersion(name: string): number[] {
  const match = name.match(/^ffmpeg-(\d+(?:\.\d+)*)/);
  return match ? match[1].split(".").map(Number) : [];
}

function compareVersions(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

/**
 * winget installs Gyan.FFmpeg as a portable package under
 * %LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_*\ffmpeg-<ver>-*\bin.
 * `listDir` is injected so the scan stays testable; it must return [] on a missing dir.
 */
export function wingetPackageBinaryPaths(
  kind: BinaryName,
  ctx: LocationContext,
  listDir: (dir: string) => string[],
): string[] {
  if (ctx.platform !== "win32" || !ctx.env.LOCALAPPDATA) {
    return [];
  }
  const file = fileName(kind, ctx.platform);
  const packages = path.win32.join(ctx.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
  return listDir(packages)
    .filter((name) => name.startsWith("Gyan.FFmpeg"))
    .flatMap((pkg) => {
      const root = path.win32.join(packages, pkg);
      return listDir(root)
        .filter((name) => name.startsWith("ffmpeg-"))
        .sort((a, b) => compareVersions(buildVersion(b), buildVersion(a)))
        .map((build) => path.win32.join(root, build, "bin", file));
    });
}
