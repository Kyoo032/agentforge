import type { ContentPart } from "@agentforge/core";
import { isRenderableImageUrl, isRenderableVideoUrl } from "./renderable-media";

/**
 * Extract image_url / video_url parts from platform tool outputs.
 * Conservative: only explicit `image` / `video` keys when `success: true`, and only
 * URLs the renderer may auto-load. A tool that hands back a remote URL is dropped
 * here; the host mirrors generated media into its own store (see
 * `saveGeneratedImage` / `saveGeneratedVideo`) and the persisted turn carries the
 * `/api/v1/media/<id>/file` path instead.
 */
export function collectToolMediaParts(output: unknown): ContentPart[] {
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return [];
  }
  const record = output as Record<string, unknown>;
  if (record.success !== true) {
    return [];
  }

  const parts: ContentPart[] = [];

  if (typeof record.image === "string" && isRenderableImageUrl(record.image)) {
    parts.push({ type: "image_url", image_url: { url: record.image } });
  }

  if (typeof record.video === "string" && isRenderableVideoUrl(record.video)) {
    parts.push({ type: "video_url", video_url: { url: record.video } });
  }

  return parts;
}
