import path from "node:path";
import { and, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { saveMedia } from "../media";
import { mediaRoot } from "../media-root";
import { readByteRange } from "../byte-range";

export async function handlePostMedia(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const file = request.files?.find((item) => item.field === "file") ?? request.files?.[0];
    if (!file) {
      return jsonOk({ error: { code: "invalid_content_part", message: "file is required" } }, 400);
    }
    const blob = new File([Buffer.from(file.bytes)], file.filename, { type: file.mime });
    const saved = await saveMedia(tenant, blob);
    return jsonOk({ id: saved.id, kind: saved.kind, mime: saved.mime, url: saved.url }, 201);
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetMediaFile(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const mediaId = request.params.mediaId;
    const rows = await db
      .select()
      .from(media)
      .where(and(eq(media.organizationId, tenant.organizationId), eq(media.id, mediaId)))
      .limit(1);
    const item = rows[0];
    if (!item) {
      return jsonOk({ error: { code: "not_found", message: "Media not found" } }, 404);
    }
    const ranged = await readByteRange(path.join(mediaRoot(), item.storagePath), request.headers.range);
    return {
      type: "bytes",
      status: ranged.status,
      bytes: ranged.bytes,
      contentType: item.mime,
      headers: ranged.headers,
    };
  } catch (error) {
    return jsonError(error);
  }
}
