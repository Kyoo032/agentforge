export type AttachmentKind = "image" | "video" | "text" | "unsupported";

/** Client caps. Images match `saveMedia`; video is the HTTP body cap (26 MB), not the 50 MB kind cap. */
export const CHAT_IMAGE_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_VIDEO_MAX_BYTES = 26 * 1024 * 1024;

export function attachmentOverCap(kind: AttachmentKind, bytes: number): boolean {
  if (kind === "image") return bytes > CHAT_IMAGE_MAX_BYTES;
  if (kind === "video") return bytes > CHAT_VIDEO_MAX_BYTES;
  return false;
}

export type FileLike = { name: string; type: string };

export type RouteDecision =
  | { route: "text" }
  | { route: "image" }
  | { route: "video" }
  | { route: "error"; message: string };

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".csv", ".json"]);

/** accept= for the composer file input (images, videos, text-like). */
export const COMPOSER_FILE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "text/*",
  "application/json",
  ".txt",
  ".md",
  ".csv",
  ".json",
].join(",");

/** accept= for job regen (images + text files; no video). */
export const JOB_REGEN_FILE_ACCEPT = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "text/*",
  "application/json",
  ".txt",
  ".md",
  ".csv",
  ".json",
].join(",");

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

export function classifyAttachment(file: FileLike): AttachmentKind {
  const mime = (file.type || "").toLowerCase();
  if (IMAGE_TYPES.has(mime)) {
    return "image";
  }
  if (VIDEO_TYPES.has(mime)) {
    return "video";
  }
  if (mime === "application/json" || mime.startsWith("text/")) {
    return "text";
  }
  if (TEXT_EXTENSIONS.has(extensionOf(file.name))) {
    return "text";
  }
  return "unsupported";
}

export function routeDecision(kinds: AttachmentKind[]): RouteDecision {
  if (kinds.some((kind) => kind === "unsupported")) {
    return { route: "error", message: "Unsupported file type" };
  }
  const hasImage = kinds.some((kind) => kind === "image");
  const hasVideo = kinds.some((kind) => kind === "video");
  if (hasImage && hasVideo) {
    return { route: "error", message: "Send image and video attachments separately" };
  }
  if (hasImage) {
    return { route: "image" };
  }
  if (hasVideo) {
    return { route: "video" };
  }
  return { route: "text" };
}

/**
 * Re-exported so the composer and the chat renderer share one rule; the rule itself
 * lives in `renderable-media` because markdown and tool output need it too.
 */
export { isRenderableImageUrl, isRenderableVideoUrl } from "./renderable-media";
