import { resolveFfmpeg } from "./ffmpeg-binary";
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
  };
  asr: EditDoctorAsr;
  fonts: string[];
};

export function getEditDoctor(): EditDoctorReport {
  const ffmpeg = resolveFfmpeg();
  return {
    ffmpeg: {
      found: ffmpeg.found,
      path: ffmpeg.path,
      version: ffmpeg.version,
      ...(ffmpeg.reason ? { reason: ffmpeg.reason } : {}),
    },
    asr: resolveAsrCapability(),
    fonts: [],
  };
}
