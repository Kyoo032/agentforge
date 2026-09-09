export type FfmpegPlatform = "macos" | "windows" | "linux";

export type FfmpegSetupHint = {
  platform: FfmpegPlatform;
  summary: string;
  installCommand: string;
  installUrl: string;
  steps: string[];
  envVar: "AGENTFORGE_FFMPEG_PATH";
};

const MIN_MAJOR = 6;

function platformOf(nodePlatform: string): FfmpegPlatform {
  if (nodePlatform === "darwin") {
    return "macos";
  }
  if (nodePlatform === "win32") {
    return "windows";
  }
  return "linux";
}

const INSTALL: Record<FfmpegPlatform, { fresh: string; upgrade: string; url: string; where: string }> = {
  macos: {
    fresh: "brew install ffmpeg",
    upgrade: "brew upgrade ffmpeg",
    url: "https://brew.sh",
    where: "Homebrew puts it in /opt/homebrew/bin (Apple silicon) or /usr/local/bin (Intel); both are checked automatically.",
  },
  windows: {
    fresh: "winget install --id Gyan.FFmpeg -e",
    upgrade: "winget upgrade --id Gyan.FFmpeg -e",
    url: "https://ffmpeg.org/download.html#build-windows",
    where: "winget, Chocolatey, Scoop and C:\\ffmpeg\\bin are checked automatically.",
  },
  linux: {
    fresh: "sudo apt install ffmpeg",
    upgrade: "sudo apt install --only-upgrade ffmpeg",
    url: "https://ffmpeg.org/download.html#build-linux",
    where: "/usr/bin, /usr/local/bin and snap are checked automatically.",
  },
};

/**
 * Human guidance for a missing or unusable ffmpeg, keyed by the host platform.
 * Rendered in the Edit studio banner, the onboarding setup check, and the agent prompt.
 */
export function ffmpegSetupHint(nodePlatform: string, reason: string | undefined): FfmpegSetupHint {
  const platform = platformOf(nodePlatform);
  const install = INSTALL[platform];
  const outdated = reason === "version_below_6";
  const broken = reason === "exec_failed" || reason === "unparsed_version";
  const summary = outdated
    ? `The ffmpeg that was found is older than ${MIN_MAJOR}. Video editing needs ${MIN_MAJOR} or newer.`
    : broken
      ? "An ffmpeg binary was found but could not run. Reinstall it or point AGENTFORGE_FFMPEG_PATH at a working build."
      : "ffmpeg was not found. Probe, cut, captions and export need it; everything else works without it.";
  const steps = [
    `Open a terminal and run: ${outdated ? install.upgrade : install.fresh}`,
    install.where,
    "Come back here and press Check again. No restart needed.",
    "Custom build? Set AGENTFORGE_FFMPEG_PATH to the full path of the ffmpeg binary and restart the app.",
  ];
  return {
    platform,
    summary,
    installCommand: outdated ? install.upgrade : install.fresh,
    installUrl: install.url,
    steps,
    envVar: "AGENTFORGE_FFMPEG_PATH",
  };
}
