import type { ContentPart } from "@agentforge/core";

function isHttpOrDataUrl(value: string, kind: "image" | "video"): boolean {
  if (value.startsWith("https://") || value.startsWith("http://")) {
    return true;
  }
  if (kind === "image" && value.startsWith("data:image/")) {
    return true;
  }
  if (kind === "image" && value.startsWith("/api/v1/media/")) {
    return true;
  }
  return false;
}

/**
 * Extract image_url / video_url parts from platform tool outputs.
 * Conservative: only explicit `image` / `video` keys when `success: true`.
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

  if (typeof record.image === "string" && isHttpOrDataUrl(record.image, "image")) {
    parts.push({ type: "image_url", image_url: { url: record.image } });
  }

  if (typeof record.video === "string" && isHttpOrDataUrl(record.video, "video")) {
    parts.push({ type: "video_url", video_url: { url: record.video } });
  }

  return parts;
}
