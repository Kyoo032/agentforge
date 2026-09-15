import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { ApiError } from "@agentforge/core";
import type { DownloadedMedia } from "./media-download";
import { downloadGeneratedMedia } from "./media-download";
import { mediaRoot } from "./media-root";

const IMAGE_MAX = 10 * 1024 * 1024;
const VIDEO_MAX = 50 * 1024 * 1024;

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

export { mediaRoot } from "./media-root";
export { mediaIdFromUrl } from "./media-id";

export async function listMediaByKind(tenant: TenantContext, kind: "image" | "video") {
  return db
    .select()
    .from(media)
    .where(and(eq(media.organizationId, tenant.organizationId), eq(media.kind, kind)))
    .orderBy(desc(media.createdAt));
}

export async function saveMedia(tenant: TenantContext, file: File) {
  const mime = file.type;
  let kind: "image" | "video";
  if (IMAGE_TYPES.has(mime)) {
    kind = "image";
    if (file.size > IMAGE_MAX) {
      throw new ApiError("invalid_image_url", "Image exceeds 10 MB", 400);
    }
  } else if (VIDEO_TYPES.has(mime)) {
    kind = "video";
    if (file.size > VIDEO_MAX) {
      throw new ApiError("invalid_video_url", "Video exceeds 50 MB", 400);
    }
  } else {
    throw new ApiError("unsupported_content_type", "Only image and video uploads are allowed", 400);
  }

  const id = crypto.randomUUID();
  const ext = mime.split("/")[1] === "quicktime" ? "mov" : mime.split("/")[1];
  const relative = `${tenant.organizationId}/${id}.${ext}`;
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
    const bytes = await readFile(path.join(mediaRoot(), item.storagePath));
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

function decodeMediaDataUrl(url: string, kind: "image" | "video"): DownloadedMedia {
  const match = url.match(new RegExp(`^data:(${kind}/[a-zA-Z0-9.+-]+);base64,(.+)$`, "s"));
  if (!match?.[1] || !match[2]) {
    throw new ApiError(`invalid_${kind}_url`, `Generated ${kind} is not a readable data URL`, 400);
  }
  return { mime: match[1], bytes: Buffer.from(match[2], "base64") };
}
