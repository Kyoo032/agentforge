import { and, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { log } from "../log";
import { saveMedia } from "../media";
import { readTenantObjectRange, removeTenantObject } from "../tenant-storage";

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
    // Phase 6: served through the object store, so a hosted deployment reads the bucket and a desk
    // reads the file — with the same tenant check in front of both, before any IO.
    const ranged = await readTenantObjectRange(tenant.tenantId, item.storagePath, request.headers.range);
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

/**
 * Phase 8 — `DELETE /api/v1/media/:mediaId`: give a tenant a way to get their bytes back.
 *
 * Phase 6 gave a hosted tenant a ceiling and a number. It did not give them a door: once a tenant
 * was at 100% every write was refused, and the only things that could free space were an operator
 * running a recompute or the tenant deleting a whole desk. `GET /api/v1/storage/usage` was
 * deliberately readable while blocked so that somebody who has just been refused can see what to
 * delete — and then there was nothing to press. This is the thing to press.
 *
 * **Bytes first, row second, and the counter moves with the bytes.** `removeTenantObject` is the
 * only writer that refunds the counter (`../tenant-storage.ts`), so deleting the row first and the
 * object second would leave a window where the tenant is charged for an object nothing references
 * — and if the process died in that window, charged forever, because nothing would ever find the
 * orphan again. This way round the worst case is an object that is gone with its row still there,
 * which the next read reports as a 404 and a `recompute` reconciles.
 *
 * **It is the tenant's own media and nothing else's.** The row is looked up with the caller's
 * `organizationId` in the WHERE, exactly as `handleGetMediaFile` does, so another tenant's id is a
 * 404 rather than a 403 — the same existence-oracle rule lane D set for every by-id route. The key
 * then goes through `assertObjectKey` inside the store, which refuses anything outside the
 * caller's prefix before any IO.
 *
 * **Idempotent.** A delete of something already deleted answers 200 with `deleted: false` rather
 * than 404: the caller asked for it to be gone and afterwards it is, and a retry after a dropped
 * connection must not read as an error.
 *
 * Not gated on the gateway or the plan: a tenant the allowance has blocked, or whose storage is
 * full, must still be able to delete. That is the whole point.
 */
export async function handleDeleteMedia(request: HostRequest): Promise<HostResult> {
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
      // Already gone, or never this tenant's. The same answer for both, on purpose.
      return jsonOk({ ok: true, deleted: false, id: mediaId });
    }
    await removeTenantObject(tenant.tenantId, item.storagePath);
    await db.delete(media).where(and(eq(media.organizationId, tenant.organizationId), eq(media.id, mediaId)));
    log.info("tenant_media_deleted", {
      tenantId: tenant.tenantId,
      mediaId,
      sizeBytes: item.sizeBytes,
    });
    return jsonOk({ ok: true, deleted: true, id: mediaId, bytesFreed: item.sizeBytes ?? 0 });
  } catch (error) {
    return jsonError(error);
  }
}
