export { db, sql } from "./client";
export type { Database } from "./client";
export { assertKernelTables, ensureSchema, listKernelTables } from "./ensure-schema";
export {
  applyPendingDataReset,
  hasPendingDataReset,
  pendingResetPath,
  requestDataReset,
  RESET_MARKER_FILE,
} from "./reset";
export type { ResetMarker, ResetOutcome } from "./reset";
export * from "./schema";
export { DrizzleAgentRepository } from "./repos/drizzle-agent-repository";
export { ensureTenant, getTenantById, getLocalTenant } from "./tenants";
export type { TenantRow, ProvisionTenantInput } from "./tenants";
// Phase 8: erase one tenant's content, and nobody else's.
export { purgeTenantRows, tenantWorkspaceIds, CASCADE_ROOT_TABLE, CASCADED_TABLES, KEPT_TENANT_TABLES, SHARED_TABLES, TENANT_SCOPED_TABLES, WORKSPACE_SCOPED_TABLES } from "./tenant-purge";
export type { PurgeSql, TenantPurgeResult } from "./tenant-purge";
export { ensurePortalOwner, resolvePortalTenant, PortalProvisionError } from "./portal-owner";
export type { PortalIdentity, PortalResolution, PortalResolveFailure } from "./portal-owner";
export {
  ensureLocalOwner,
  listLocalWorkspaces,
  createLocalWorkspace,
  updateLocalWorkspace,
  deleteLocalWorkspace,
} from "./ensure-local-owner";
