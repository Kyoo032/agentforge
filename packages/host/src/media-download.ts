import { ApiError, fetchPublicHttps } from "@agentforge/core";

/** Byte caps for media mirrored into the local store; they match `saveMedia`'s own limits. */
export const GENERATED_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const GENERATED_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const GENERATED_AUDIO_MAX_BYTES = 25 * 1024 * 1024;

export type GeneratedMediaKind = "image" | "video" | "audio";

export type DownloadedMedia = { mime: string; bytes: Buffer };

export type DownloadGeneratedMediaOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

const DEFAULT_MIME: Record<GeneratedMediaKind, string> = {
  image: "image/png",
  video: "video/mp4",
  audio: "audio/mpeg",
};
const MAX_BYTES: Record<GeneratedMediaKind, number> = {
  image: GENERATED_IMAGE_MAX_BYTES,
  video: GENERATED_VIDEO_MAX_BYTES,
  audio: GENERATED_AUDIO_MAX_BYTES,
};
const ERROR_CODE: Record<GeneratedMediaKind, string> = {
  image: "invalid_image_url",
  video: "invalid_video_url",
  audio: "invalid_audio_url",
};

/**
 * Download media a model or gateway told us about. The URL is theirs, not ours, so it
 * goes through `fetchPublicHttps`: HTTPS only, no credentials, no loopback or private
 * host on any hop, a timeout, and a byte cap enforced while the body streams. The
 * failing URL never appears in the error, which surfaces to the client.
 */
export async function downloadGeneratedMedia(
  url: string,
  kind: GeneratedMediaKind,
  options: DownloadGeneratedMediaOptions = {},
): Promise<DownloadedMedia> {
  const result = await fetchPublicHttps(url, {
    maxBytes: MAX_BYTES[kind],
    fetchImpl: options.fetchImpl,
    signal: options.signal,
  });
  if (result.status < 200 || result.status >= 300) {
    throw new ApiError(ERROR_CODE[kind], `Could not download the generated ${kind} (${result.status})`, 502);
  }
  const served = result.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  const mime = served.startsWith(`${kind}/`) ? served : DEFAULT_MIME[kind];
  return { mime, bytes: result.body };
}
