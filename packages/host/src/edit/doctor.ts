import { resolveFfmpeg } from "./ffmpeg-binary";

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

function resolveAsr(): EditDoctorAsr {
  const model = process.env.AGENTFORGE_EDIT_ASR_MODEL?.trim();
  if (!model) {
    return { available: false, backend: null, model: null };
  }
  return { available: true, backend: "gateway", model };
}

export function getEditDoctor(): EditDoctorReport {
  const ffmpeg = resolveFfmpeg();
  return {
    ffmpeg: {
      found: ffmpeg.found,
      path: ffmpeg.path,
      version: ffmpeg.version,
      ...(ffmpeg.reason ? { reason: ffmpeg.reason } : {}),
    },
    asr: resolveAsr(),
    fonts: [],
  };
}
