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
export {
  ensureLocalOwner,
  listLocalWorkspaces,
  createLocalWorkspace,
  updateLocalWorkspace,
  deleteLocalWorkspace,
} from "./ensure-local-owner";
