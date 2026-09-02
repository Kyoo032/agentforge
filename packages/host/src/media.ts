import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { and, desc, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { TenantContext } from "@agentforge/core";
import { ApiError } from "@agentforge/core";
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

export async function saveGeneratedImage(tenant: TenantContext, url: string): Promise<string> {
  if (url.startsWith("/api/v1/media/")) {
    return url;
  }
  let mime = "image/png";
  let bytes: Buffer;
  if (url.startsWith("data:image/")) {
    const match = url.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match?.[1] || !match[2]) {
      return url;
    }
    mime = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else if (url.startsWith("https://")) {
    const response = await fetch(url);
    if (!response.ok) {
      return url;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (type && type.startsWith("image/")) {
      mime = type;
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    return url;
  }
  try {
    const saved = await saveMedia(tenant, new File([new Uint8Array(bytes)], `generated.${mime.split("/")[1] ?? "png"}`, { type: mime }));
    return saved.url;
  } catch {
    return url;
  }
}

export async function saveGeneratedVideo(tenant: TenantContext, url: string): Promise<string> {
  if (url.startsWith("/api/v1/media/")) {
    return url;
  }
  let mime = "video/mp4";
  let bytes: Buffer;
  if (url.startsWith("data:video/")) {
    const match = url.match(/^data:(video\/[a-zA-Z0-9.+-]+);base64,(.+)$/s);
    if (!match?.[1] || !match[2]) {
      return url;
    }
    mime = match[1];
    bytes = Buffer.from(match[2], "base64");
  } else if (url.startsWith("https://") || url.startsWith("http://")) {
    const response = await fetch(url);
    if (!response.ok) {
      return url;
    }
    const type = response.headers.get("content-type")?.split(";")[0]?.trim();
    if (type && type.startsWith("video/")) {
      mime = type;
    }
    bytes = Buffer.from(await response.arrayBuffer());
  } else {
    return url;
  }
  const ext = mime.split("/")[1] === "quicktime" ? "mov" : (mime.split("/")[1] ?? "mp4");
  try {
    const saved = await saveMedia(
      tenant,
      new File([new Uint8Array(bytes)], `generated.${ext}`, { type: mime }),
    );
    return saved.url;
  } catch {
    return url;
  }
}
