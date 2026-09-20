import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { ApiError } from "@agentforge/core";
import type { DownloadedMedia } from "./media-download";
import { downloadGeneratedMedia } from "./media-download";
import { mediaFilePath, mediaRelativePath, mediaRoot } from "./media-root";

const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;
/** A Suno take is a few minutes of mp3; 25 MB covers that with room, well under the video cap. */
const AUDIO_MAX = 25 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_TYPES = new Set(["audio/mpeg", "audio/mp4", "audio/wav", "audio/x-wav", "audio/ogg", "audio/webm", "audio/flac"]);

/** File extension for a stored mime, where the subtype is not already the extension. */
const MEDIA_EXT: Record<string, string> = {
  "video/quicktime": "mov",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/x-wav": "wav",
};

function mediaExt(mime: string): string {
  return MEDIA_EXT[mime] ?? mime.split("/")[1] ?? "bin";
}

export { mediaRoot } from "./media-root";
export { mediaIdFromUrl } from "./media-id";

export type StoredMediaKind = "image" | "video" | "audio";

export async function listMediaByKind(tenant: TenantContext, kind: StoredMediaKind) {
  return db
    .select()
    .from(media)
    .where(and(eq(media.organizationId, tenant.organizationId), eq(media.kind, kind)))
    .orderBy(desc(media.createdAt));
}

/**
 * Kinds a caller is willing to store.
 *
 * The chat upload route keeps the narrow default on purpose (G-27, `edit/import.test.ts`): Edit owns
 * its own 500 MB import path with its own guard, and generated audio never arrives as an upload at
 * all — it comes through `saveGeneratedAudio`. Widening this default would quietly turn the chat
 * media route into a second, unguarded audio import.
 */
export const DEFAULT_UPLOAD_KINDS: readonly StoredMediaKind[] = ["image", "video"];

const KIND_FOR_TYPE: Array<{ kind: StoredMediaKind; types: Set<string>; max: number; code: string; label: string }> = [
  { kind: "image", types: IMAGE_TYPES, max: IMAGE_MAX, code: "invalid_image_url", label: "Image exceeds 10 MB" },
  { kind: "video", types: VIDEO_TYPES, max: VIDEO_MAX, code: "invalid_video_url", label: "Video exceeds 50 MB" },
  { kind: "audio", types: AUDIO_TYPES, max: AUDIO_MAX, code: "invalid_audio_url", label: "Audio exceeds 25 MB" },
];

function listKinds(allow: readonly StoredMediaKind[]): string {
  if (allow.length <= 1) {
    return allow[0] ?? "no";
  }
  return `${allow.slice(0, -1).join(", ")} and ${allow[allow.length - 1]}`;
}

export async function saveMedia(
  tenant: TenantContext,
  file: File,
  allow: readonly StoredMediaKind[] = DEFAULT_UPLOAD_KINDS,
) {
  const mime = file.type;
  const match = KIND_FOR_TYPE.find((entry) => entry.types.has(mime) && allow.includes(entry.kind));
  if (!match) {
    throw new ApiError("unsupported_content_type", `Only ${listKinds(allow)} uploads are allowed`, 400);
  }
  if (file.size > match.max) {
    throw new ApiError(match.code, match.label, 400);
  }
  const kind = match.kind;

  const id = crypto.randomUUID();
  const ext = mediaExt(mime);
  // Phase 3 lane D: the tenant prefix comes first, then the organization, so a tenant's blobs
  // are one subtree. The local tenant's prefix is empty, so its rows keep the pre-Phase-3 shape.
  const relative = mediaRelativePath(tenant.tenantId, [tenant.organizationId], `${id}.${ext}`);
  const fullPath = path.join(mediaRoot(), relative);
  await mkdir(path.dirname(fullPath), { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(fullPath, buffer);
  const url = `/api/v1/media/${id}/file`;
  const [row] = await db
    .insert(media)
    .values({
      id,
      organizationId: tenant.organizationId,
      userId: tenant.userId,
      kind,
      mime,
      sizeBytes: file.size,
      storagePath: relative,
      url,
    })
    .returning();
  return row;
}

export async function readMediaDataUrl(tenant: TenantContext, mediaId: string): Promise<string | null> {
  const rows = await db
    .select()
    .from(media)
    .where(and(eq(media.organizationId, tenant.organizationId), eq(media.id, mediaId)))
    .limit(1);
  const item = rows[0];
  if (!item) {
    return null;
  }
  try {
    const bytes = await readFile(mediaFilePath(tenant.tenantId, item.storagePath));
    return `data:${item.mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Mirror a generated image into the local store so the renderer only ever loads
 * host-served media. A remote URL is fetched through `downloadGeneratedMedia`
 * (HTTPS only, redirect-checked, capped); anything it cannot mirror throws rather
 * than handing the caller a URL pointing at someone else's origin.
 */
export async function saveGeneratedImage(tenant: TenantContext, url: string): Promise<string> {
  if (url.startsWith("/api/v1/media/")) {
    return url;
  }
  const downloaded = url.startsWith("data:image/")
    ? decodeMediaDataUrl(url, "image")
    : await downloadGeneratedMedia(url, "image");
  const ext = downloaded.mime.split("/")[1] ?? "png";
  const saved = await saveMedia(
    tenant,
    new File([new Uint8Array(downloaded.bytes)], `generated.${ext}`, { type: downloaded.mime }),
  );
  return saved.url;
}

/**
 * Audio twin of `saveGeneratedImage`. Music arrives as a remote URL from the Suno relay; speech
 * arrives as a data URL because `/v1/audio/speech` answers with bytes rather than a link.
 */
export async function saveGeneratedAudio(tenant: TenantContext, url: string): Promise<string> {
  if (url.startsWith("/api/v1/media/")) {
    return url;
  }
  const downloaded = url.startsWith("data:audio/")
    ? decodeMediaDataUrl(url, "audio")
    : await downloadGeneratedMedia(url, "audio");
  const saved = await saveMedia(
    tenant,
    new File([new Uint8Array(downloaded.bytes)], `generated.${mediaExt(downloaded.mime)}`, {
      type: downloaded.mime,
    }),
    ["audio"],
  );
  return saved.url;
}

/** Video twin of `saveGeneratedImage`; plain http:// is not a mirrorable source. */
export async function saveGeneratedVideo(tenant: TenantContext, url: string): Promise<string> {
  if (url.startsWith("/api/v1/media/")) {
    return url;
  }
  const downloaded = url.startsWith("data:video/")
    ? decodeMediaDataUrl(url, "video")
    : await downloadGeneratedMedia(url, "video");
  const subtype = downloaded.mime.split("/")[1];
  const ext = subtype === "quicktime" ? "mov" : (subtype ?? "mp4");
  const saved = await saveMedia(
    tenant,
    new File([new Uint8Array(downloaded.bytes)], `generated.${ext}`, { type: downloaded.mime }),
  );
  return saved.url;
}

function decodeMediaDataUrl(url: string, kind: StoredMediaKind): DownloadedMedia {
  const match = url.match(new RegExp(`^data:(${kind}/[a-zA-Z0-9.+-]+);base64,(.+)$`, "s"));
  if (!match?.[1] || !match[2]) {
    throw new ApiError(`invalid_${kind}_url`, `Generated ${kind} is not a readable data URL`, 400);
  }
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}
