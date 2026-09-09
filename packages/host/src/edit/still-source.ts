import { ApiError, isLoopbackHost, localMediaId, type EditProject, type EditStartGenerateJobInput } from "@agentforge/core";

/** Where the still for an image-to-video job lives. Local media is inlined as a data URL at submit time. */
export type StillSource =
  | { kind: "local"; assetId: string | undefined; mediaId: string }
  | { kind: "remote"; url: string };

type StillInput = Pick<EditStartGenerateJobInput, "imageAssetId" | "imageUrl">;

const DESKTOP_MEDIA = /^agentforge:\/\/media\/([0-9a-f-]{36})\/?$/i;

function mediaIdFromUrl(url: string): string | null {
  const desktop = url.trim().match(DESKTOP_MEDIA);
  if (desktop?.[1]) {
    return desktop[1].toLowerCase();
  }
  return localMediaId(url);
}

function assetIdForMedia(doc: EditProject, mediaId: string): string | undefined {
  return Object.values(doc.assets).find((asset) => asset.mediaId === mediaId)?.id;
}

function isPublicHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !isLoopbackHost(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Swap a job's `stillMediaId` for a data URL right before the provider call, so the
 * base64 body never lands in the job row or the project bundle. Throws when the
 * media is gone so the job fails loudly instead of silently becoming text-to-video.
 */
export async function withInlinedStill<T extends Record<string, unknown>>(
  request: T,
  read: (mediaId: string) => Promise<string | null>,
): Promise<T> {
  const mediaId = request.stillMediaId;
  if (typeof mediaId !== "string" || !mediaId) {
    return request;
  }
  const dataUrl = await read(mediaId);
  if (!dataUrl) {
    throw new ApiError("still_not_found", "The still image for this job is no longer available.", 400);
  }
  const { stillMediaId: _omit, ...rest } = request;
  return { ...rest, imageUrl: dataUrl } as unknown as T;
}

/**
 * Resolve the still an owner asked for. Returns `null` when none was requested and
 * `"unresolvable"` when one was requested but cannot reach a provider, so the caller
 * can fail fast instead of quietly falling back to text-to-video.
 */
export function resolveStillSource(doc: EditProject, input: StillInput): StillSource | null | "unresolvable" {
  if (input.imageAssetId) {
    const asset = doc.assets[input.imageAssetId];
    if (!asset?.mediaId) {
      return "unresolvable";
    }
    return { kind: "local", assetId: asset.id, mediaId: asset.mediaId };
  }
  const url = input.imageUrl?.trim();
  if (!url) {
    return null;
  }
  const mediaId = mediaIdFromUrl(url);
  if (mediaId) {
    return { kind: "local", assetId: assetIdForMedia(doc, mediaId), mediaId };
  }
  if (isPublicHttpUrl(url)) {
    return { kind: "remote", url };
  }
  return "unresolvable";
}
