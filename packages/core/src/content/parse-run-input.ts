import { ContentParseError } from "../errors";
import type { ContentPart, ImageUrlPart, RunInputBody, TextPart, VideoUrlPart } from "./types";

const UNSUPPORTED = "unsupported_content_type";
const FILE_TYPES = new Set(["file", "input_file", "input_image", "input_file_id", "file_id"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnsupportedPart(part: Record<string, unknown>): void {
  const type = part.type;
  if (typeof type === "string" && FILE_TYPES.has(type)) {
    throw new ContentParseError(UNSUPPORTED, `Content type '${type}' is not supported`);
  }
}

function parseTextPart(part: Record<string, unknown>): TextPart {
  rejectUnsupportedPart(part);
  if (part.type !== "text") {
    throw new ContentParseError(UNSUPPORTED, `Content type '${String(part.type)}' is not supported on this route`);
  }
  if (typeof part.text !== "string") {
    throw new ContentParseError("invalid_content_part", "text parts require a string text field");
  }
  return { type: "text", text: part.text };
}

function assertHttpOrDataUrl(url: string, kind: "image" | "video"): void {
  if (url.startsWith("/api/v1/media/")) {
    return;
  }
  if (url.startsWith("data:")) {
    if (kind === "image" && !/^data:image\/(png|jpeg|jpg|gif|webp)/i.test(url)) {
      throw new ContentParseError(UNSUPPORTED, "Non-image data URLs are not supported");
    }
    if (kind === "video" && !/^data:video\/(mp4|webm|quicktime|mov)/i.test(url)) {
      throw new ContentParseError(UNSUPPORTED, "Non-video data URLs are not supported");
    }
    return;
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ContentParseError(kind === "image" ? "invalid_image_url" : "invalid_video_url", "URL scheme must be http(s) or data");
    }
  } catch (error) {
    if (error instanceof ContentParseError) {
      throw error;
    }
    throw new ContentParseError(kind === "image" ? "invalid_image_url" : "invalid_video_url", "URL is invalid");
  }
}

function parseImagePart(part: Record<string, unknown>): ImageUrlPart {
  rejectUnsupportedPart(part);
  if (part.type === "video_url") {
    throw new ContentParseError(UNSUPPORTED, "video_url is not supported on the image route");
  }
  if (part.type !== "image_url") {
    throw new ContentParseError(UNSUPPORTED, `Content type '${String(part.type)}' is not supported on this route`);
  }
  const imageUrl = part.image_url;
  if (!isRecord(imageUrl) || typeof imageUrl.url !== "string" || imageUrl.url.length === 0) {
    throw new ContentParseError("invalid_image_url", "image_url.url is required");
  }
  assertHttpOrDataUrl(imageUrl.url, "image");
  const detail = imageUrl.detail;
  if (detail !== undefined && detail !== "low" && detail !== "high" && detail !== "auto") {
    throw new ContentParseError("invalid_image_url", "image_url.detail must be low, high, or auto");
  }
  return {
    type: "image_url",
    image_url: {
      url: imageUrl.url,
      ...(detail ? { detail } : {}),
    },
  };
}

function parseVideoPart(part: Record<string, unknown>): VideoUrlPart {
  rejectUnsupportedPart(part);
  if (part.type === "image_url") {
    throw new ContentParseError(UNSUPPORTED, "image_url is not supported on the video route");
  }
  if (part.type !== "video_url") {
    throw new ContentParseError(UNSUPPORTED, `Content type '${String(part.type)}' is not supported on this route`);
  }
  const videoUrl = part.video_url;
  if (!isRecord(videoUrl) || typeof videoUrl.url !== "string" || videoUrl.url.length === 0) {
    throw new ContentParseError("invalid_video_url", "video_url.url is required");
  }
  assertHttpOrDataUrl(videoUrl.url, "video");
  return { type: "video_url", video_url: { url: videoUrl.url } };
}

function requireContent(body: RunInputBody): unknown {
  if (body.content === undefined) {
    throw new ContentParseError("invalid_content_part", "content is required");
  }
  return body.content;
}

function parseStream(body: RunInputBody): boolean {
  if (body.stream === undefined) {
    return true;
  }
  if (typeof body.stream !== "boolean") {
    throw new ContentParseError("invalid_content_part", "stream must be a boolean");
  }
  return body.stream;
}

export function parseTextRunInput(body: RunInputBody): { parts: ContentPart[]; stream: boolean } {
  const content = requireContent(body);
  const stream = parseStream(body);
  if (typeof content === "string") {
    if (content.trim().length === 0) {
      throw new ContentParseError("invalid_content_part", "text content cannot be empty");
    }
    return { parts: [{ type: "text", text: content }], stream };
  }
  if (!Array.isArray(content)) {
    throw new ContentParseError("invalid_content_part", "content must be a string or array of parts");
  }
  if (content.length === 0) {
    throw new ContentParseError("invalid_content_part", "content cannot be empty");
  }
  const parts: ContentPart[] = content.map((item) => {
    if (!isRecord(item)) {
      throw new ContentParseError("invalid_content_part", "content parts must be objects");
    }
    rejectUnsupportedPart(item);
    if (item.type === "image_url" || item.type === "video_url") {
      throw new ContentParseError(UNSUPPORTED, `${item.type} is not supported on the text route`);
    }
    return parseTextPart(item);
  });
  const hasText = parts.some((part) => part.type === "text" && part.text.trim().length > 0);
  if (!hasText) {
    throw new ContentParseError("invalid_content_part", "text content cannot be empty");
  }
  return { parts, stream };
}

export function parseImageRunInput(body: RunInputBody): { parts: ContentPart[]; stream: boolean } {
  const content = requireContent(body);
  const stream = parseStream(body);
  if (typeof content === "string") {
    throw new ContentParseError("invalid_content_part", "image runs require an array of content parts with image_url");
  }
  if (!Array.isArray(content) || content.length === 0) {
    throw new ContentParseError("invalid_content_part", "image runs require an array of content parts");
  }
  const parts: ContentPart[] = content.map((item) => {
    if (!isRecord(item)) {
      throw new ContentParseError("invalid_content_part", "content parts must be objects");
    }
    rejectUnsupportedPart(item);
    if (item.type === "text") {
      return parseTextPart(item);
    }
    return parseImagePart(item);
  });
  const imageCount = parts.filter((part) => part.type === "image_url").length;
  if (imageCount < 1) {
    throw new ContentParseError("invalid_content_part", "image runs require at least one image_url part");
  }
  return { parts, stream };
}

export function parseVideoRunInput(body: RunInputBody): { parts: ContentPart[]; stream: boolean } {
  const content = requireContent(body);
  const stream = parseStream(body);
  if (typeof content === "string") {
    throw new ContentParseError("invalid_content_part", "video runs require an array of content parts with video_url");
  }
  if (!Array.isArray(content) || content.length === 0) {
    throw new ContentParseError("invalid_content_part", "video runs require an array of content parts");
  }
  const parts: ContentPart[] = content.map((item) => {
    if (!isRecord(item)) {
      throw new ContentParseError("invalid_content_part", "content parts must be objects");
    }
    rejectUnsupportedPart(item);
    if (item.type === "text") {
      return parseTextPart(item);
    }
    return parseVideoPart(item);
  });
  const videoCount = parts.filter((part) => part.type === "video_url").length;
  if (videoCount < 1) {
    throw new ContentParseError("invalid_content_part", "video runs require at least one video_url part");
  }
  return { parts, stream };
}

export function summarizeParts(parts: ContentPart[]): string {
  const text = parts
    .filter((part): part is TextPart => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim();
  const images = parts.filter((part) => part.type === "image_url").length;
  const videos = parts.filter((part) => part.type === "video_url").length;
  const prefix = [
    images ? `[${images} image${images === 1 ? "" : "s"}]` : "",
    videos ? `[${videos} video${videos === 1 ? "" : "s"}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return [prefix, text].filter(Boolean).join(" ").trim();
}
