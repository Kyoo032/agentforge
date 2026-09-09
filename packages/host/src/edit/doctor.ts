import { resetFfmpegBinaryCache, resolveFfmpeg } from "./ffmpeg-binary";
import { ffmpegSetupHint, type FfmpegSetupHint } from "./ffmpeg-setup";
import { resolveAsrCapability } from "./asr";

export type EditDoctorAsr = {
  available: boolean;
  backend: string | null;
  model: string | null;
};

export type EditDoctorReport = {
  ffmpeg: {
    found: boolean;
    path: string | null;
    version: string | null;
    reason?: string;
    /** Present only when ffmpeg is missing or unusable: how to install it on this OS. */
    setup?: FfmpegSetupHint;
  };
  asr: EditDoctorAsr;
  fonts: string[];
};

export type EditDoctorOptions = {
  /** Drop the cached probe so a freshly installed ffmpeg is picked up without a restart. */
  recheck?: boolean;
};

/** Minimum gap between forced re-probes; each probe runs ffmpeg synchronously, so this caps abuse from a local page. */
export const RECHECK_MIN_INTERVAL_MS = 2_000;

let lastRecheckAt = 0;

export function resetDoctorRecheckThrottle(): void {
  lastRecheckAt = 0;
}

export function getEditDoctor(options: EditDoctorOptions = {}, now: number = Date.now()): EditDoctorReport {
  if (options.recheck && now - lastRecheckAt >= RECHECK_MIN_INTERVAL_MS) {
    lastRecheckAt = now;
    resetFfmpegBinaryCache();
  }
  const ffmpeg = resolveFfmpeg();
  return {
    ffmpeg: {
      found: ffmpeg.found,
      path: ffmpeg.path,
      version: ffmpeg.version,
      ...(ffmpeg.reason ? { reason: ffmpeg.reason } : {}),
      ...(ffmpeg.found ? {} : { setup: ffmpegSetupHint(process.platform, ffmpeg.reason) }),
    },
    asr: resolveAsrCapability(),
    fonts: [],
  };
}
