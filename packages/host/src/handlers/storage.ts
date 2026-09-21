/**
 * Phase 6 — what a tenant is holding.
 *
 *   GET /api/v1/storage/usage   ← the signed-in tenant. Bytes used, the ceiling, and the percentage.
 *
 * Deliberately readable by a tenant that is already over its quota: the whole point of the number
 * is to tell somebody who has just been refused a write what to delete, and a route that refuses
 * the blocked is a dead end in exactly the case it exists for. It is scoped by `getTenant(request)`
 * like every other by-tenant route, so it reports the caller's own bytes and nobody else's.
 *
 * Phase 8 adds `largest`, and it is the other half of that sentence. "What to delete" was advice
 * with nothing behind it while the only answer available to a full tenant was to guess: the studio
 * galleries list images and videos with no size on them, so nothing in the product could say which
 * object was the one taking the room. This route already knows the tenant, already answers while
 * blocked and is already the screen's one read, so the list belongs here rather than on a route of
 * its own — one request, and the number and the things it is made of cannot disagree.
 */
import { and, desc, eq } from "drizzle-orm";
import { db, media } from "@agentforge/db";
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { tenantStorageReport } from "../tenant-storage";

/**
 * How many objects the screen is handed. Enough that the answer to "what is filling this account"
 * is on it, short enough that it is a list rather than a file manager — a tenant with ten thousand
 * objects is not going to clear space by scrolling, and the biggest twenty is where the bytes are.
 */
export const LARGEST_OBJECT_LIMIT = 20;

export async function handleGetStorageUsage(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    const report = await tenantStorageReport(tenant.tenantId);
    // Scoped by `organizationId`, exactly as `handleGetMediaFile` and `handleDeleteMedia` are: the
    // media table is org-keyed, and using the caller's own org is what makes every id on this list
    // an id the caller may then delete. A tenant id in the WHERE would be wider than the delete.
    const rows = await db
      .select({
        id: media.id,
        kind: media.kind,
        mime: media.mime,
        sizeBytes: media.sizeBytes,
        createdAt: media.createdAt,
      })
      .from(media)
      .where(and(eq(media.organizationId, tenant.organizationId)))
      .orderBy(desc(media.sizeBytes))
      .limit(LARGEST_OBJECT_LIMIT);
    return jsonOk({
      ...report,
      largest: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}
