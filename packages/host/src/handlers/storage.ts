/**
 * Phase 6 — what a tenant is holding.
 *
 *   GET /api/v1/storage/usage   ← the signed-in tenant. Bytes used, the ceiling, and the percentage.
 *
 * Deliberately readable by a tenant that is already over its quota: the whole point of the number
 * is to tell somebody who has just been refused a write what to delete, and a route that refuses
 * the blocked is a dead end in exactly the case it exists for. It is scoped by `getTenant(request)`
 * like every other by-tenant route, so it reports the caller's own bytes and nobody else's.
 */
import type { HostRequest, HostResult } from "../types";
import { jsonError, jsonOk } from "../errors";
import { getTenant } from "../tenant";
import { tenantStorageReport } from "../tenant-storage";

export async function handleGetStorageUsage(request: HostRequest): Promise<HostResult> {
  try {
    const tenant = await getTenant(request);
    return jsonOk(await tenantStorageReport(tenant.tenantId));
  } catch (error) {
    return jsonError(error);
  }
}
