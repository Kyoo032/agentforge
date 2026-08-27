import { isLoopbackHost } from "../security/tls";

const LOCAL_MEDIA_PATH = /\/api\/v1\/media\/([0-9a-f-]{36})\/file\/?$/i;
const LOCAL_IMAGE_PLACEHOLDER = "[Image attached in the local app. It is already shown to the user.]";
const URL_KEYS = new Set(["image_url", "imageUrl", "image", "url"]);

export function localMediaId(url: string): string | null {
  const trimmed = url.trim();
  const relative = trimmed.match(/^\/api\/v1\/media\/([0-9a-f-]{36})\/file\/?$/i);
  if (relative?.[1]) {
    return relative[1].toLowerCase();
  }
  try {
    const parsed = new URL(trimmed);
    const match = parsed.pathname.match(LOCAL_MEDIA_PATH);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** True when a remote inference host cannot fetch this URL (loopback or app-relative media). */
export function isUnreachableProviderMediaUrl(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith("data:")) {
    return false;
  }
  if (localMediaId(trimmed)) {
    return true;
  }
  try {
    return isLoopbackHost(new URL(trimmed).hostname);
  } catch {
    return false;
  }
}

export function imagePartForProvider(url: string): { type: "image"; image: string } | { type: "text"; text: string } {
  if (url.startsWith("data:") || (url.startsWith("https://") && !isUnreachableProviderMediaUrl(url))) {
    return { type: "image", image: url };
  }
  return { type: "text", text: LOCAL_IMAGE_PLACEHOLDER };
}

export function scrubUnreachableMediaArgs(args: unknown): unknown {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return args;
  }
  const next: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  for (const key of ["image_url", "imageUrl", "image"]) {
    const value = next[key];
    if (typeof value === "string" && isUnreachableProviderMediaUrl(value)) {
      delete next[key];
    }
  }
  return next;
}

/**
 * Strip loopback / relative media URLs from an OpenAI-compatible request body.
 * The gateway SSRF-blocks port 3000; tool-call args in a later step still carry the original URL.
 */
export function rewriteUnreachableMediaInJson(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") || trimmed.startsWith("[")) &&
      /127\.0\.0\.1|localhost|\/api\/v1\/media\//i.test(trimmed)
    ) {
      try {
        return JSON.stringify(rewriteUnreachableMediaInJson(JSON.parse(trimmed)));
      } catch {
        return value;
      }
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(rewriteUnreachableMediaInJson);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const record = value as Record<string, unknown>;
  const type = record.type;
  const imageUrl = record.image_url;
  if (type === "image_url" && imageUrl && typeof imageUrl === "object") {
    const url = (imageUrl as { url?: unknown }).url;
    if (typeof url === "string" && isUnreachableProviderMediaUrl(url)) {
      return { type: "text", text: LOCAL_IMAGE_PLACEHOLDER };
    }
  }
  if (
    (type === "image" || type === "input_image") &&
    typeof record.image === "string" &&
    isUnreachableProviderMediaUrl(record.image)
  ) {
    return { type: "text", text: LOCAL_IMAGE_PLACEHOLDER };
  }
  if (
    (type === "image" || type === "input_image") &&
    typeof record.image_url === "string" &&
    isUnreachableProviderMediaUrl(record.image_url)
  ) {
    return { type: "text", text: LOCAL_IMAGE_PLACEHOLDER };
  }

  const next: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(record)) {
    if (typeof child === "string" && isUnreachableProviderMediaUrl(child) && URL_KEYS.has(key)) {
      continue;
    }
    next[key] = rewriteUnreachableMediaInJson(child);
  }
  return next;
}
