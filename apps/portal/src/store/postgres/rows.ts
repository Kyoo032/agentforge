/**
 * Row -> domain mapping, and the freeze that makes the result read-only.
 *
 * One file so the column names of `docs/internal/portal/migrations/0002` appear exactly once each.
 */
import type {
  AuditEntry,
  AuthCode,
  Device,
  DeviceCode,
  Iso,
  JsonObject,
  LoginOtp,
  OAuthClient,
  Org,
  RefreshToken,
  Session,
  Tenant,
  TenantConfig,
  TenantFeatureFlags,
  User,
} from "../types";

/** Anything `pg` hands back for one row. */
export type Row = Record<string, unknown>;

/**
 * Deep-frozen on the way out. Callers get a value they cannot quietly edit and then wonder why
 * the database disagrees.
 */
export function freeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    freeze(nested);
  }
  return Object.freeze(value);
}

export function iso(value: unknown): Iso {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(String(value)).toISOString();
}

export function isoOrNull(value: unknown): Iso | null {
  return value === null || value === undefined ? null : iso(value);
}

function str(value: unknown): string {
  return String(value);
}

function strOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function int(value: unknown): number {
  return typeof value === "number" ? value : Number(value);
}

function json(value: unknown): JsonObject {
  if (value && typeof value === "object") {
    return value as JsonObject;
  }
  if (typeof value === "string") {
    return JSON.parse(value) as JsonObject;
  }
  return {};
}

function jsonOrNull(value: unknown): JsonObject | null {
  return value === null || value === undefined ? null : json(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

export function toTenant(row: Row): Tenant {
  return freeze({
    id: str(row.id),
    slug: str(row.slug),
    name: str(row.name),
    status: str(row.status) as Tenant["status"],
    residency: str(row.residency),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    suspendedAt: isoOrNull(row.suspended_at),
  });
}

export function toTenantConfig(row: Row): TenantConfig {
  return freeze({
    tenantId: str(row.tenant_id),
    version: int(row.version),
    branding: json(row.branding),
    modelAllowlist: stringArray(row.model_allowlist),
    featureFlags: json(row.feature_flags) as TenantFeatureFlags,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export function toOrg(row: Row): Org {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    name: str(row.name),
    slug: str(row.slug),
    status: str(row.status) as Org["status"],
    plan: str(row.plan) as Org["plan"],
    seatCap: int(row.seat_cap),
    seatBand: int(row.seat_band),
    currency: str(row.currency) as Org["currency"],
    billingEmail: strOrNull(row.billing_email),
    pastDueSince: isoOrNull(row.past_due_since),
    featureFlags: json(row.feature_flags) as TenantFeatureFlags,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export function toUser(row: Row): User {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    orgId: str(row.org_id),
    email: str(row.email),
    displayName: strOrNull(row.display_name),
    status: str(row.status) as User["status"],
    role: str(row.role) as User["role"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    deactivatedAt: isoOrNull(row.deactivated_at),
  });
}

export function toDevice(row: Row): Device {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    orgId: str(row.org_id),
    userId: str(row.user_id),
    installId: str(row.install_id),
    label: strOrNull(row.label),
    platform: str(row.platform) as Device["platform"],
    osVersion: strOrNull(row.os_version),
    appVersion: strOrNull(row.app_version),
    status: str(row.status) as Device["status"],
    firstSeenAt: iso(row.first_seen_at),
    lastSeenAt: iso(row.last_seen_at),
    revokedAt: isoOrNull(row.revoked_at),
    revokedReason: strOrNull(row.revoked_reason),
  });
}

export function toSession(row: Row): Session {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    orgId: str(row.org_id),
    userId: str(row.user_id),
    deviceId: str(row.device_id),
    scope: str(row.scope),
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at),
    absoluteExpiresAt: iso(row.absolute_expires_at),
    revokedAt: isoOrNull(row.revoked_at),
    revokedReason: strOrNull(row.revoked_reason),
  });
}

/** `token_hash` is deliberately not mapped: it never leaves the store. */
export function toRefreshToken(row: Row): RefreshToken {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    sessionId: str(row.session_id),
    generation: int(row.generation),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    usedAt: isoOrNull(row.used_at),
    replacedBy: strOrNull(row.replaced_by),
    revokedAt: isoOrNull(row.revoked_at),
    revokedReason: strOrNull(row.revoked_reason),
  });
}

export function toDeviceCode(row: Row): DeviceCode {
  return freeze({
    id: str(row.id),
    tenantId: strOrNull(row.tenant_id),
    userCode: str(row.user_code),
    status: str(row.status) as DeviceCode["status"],
    userId: strOrNull(row.user_id),
    orgId: strOrNull(row.org_id),
    deviceId: strOrNull(row.device_id),
    sessionId: strOrNull(row.session_id),
    installId: strOrNull(row.install_id),
    platform: strOrNull(row.platform) as DeviceCode["platform"],
    clientName: strOrNull(row.client_name),
    clientVersion: strOrNull(row.client_version),
    requestedScope: str(row.requested_scope),
    intervalSeconds: int(row.interval_seconds),
    pollCount: int(row.poll_count),
    lastPolledAt: isoOrNull(row.last_polled_at),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    approvedAt: isoOrNull(row.approved_at),
    deniedAt: isoOrNull(row.denied_at),
    usedAt: isoOrNull(row.used_at),
  });
}

/** `otp_hash` is deliberately not mapped. */
export function toLoginOtp(row: Row): LoginOtp {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    email: str(row.email),
    purpose: str(row.purpose) as LoginOtp["purpose"],
    attempts: int(row.attempts),
    consumedAt: isoOrNull(row.consumed_at),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
  });
}

/** `code_hash` and `state_hash` are deliberately not mapped. */
export function toAuthCode(row: Row): AuthCode {
  return freeze({
    id: str(row.id),
    tenantId: str(row.tenant_id),
    orgId: str(row.org_id),
    userId: str(row.user_id),
    clientId: str(row.client_id),
    redirectUri: str(row.redirect_uri),
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    consumedAt: isoOrNull(row.consumed_at),
  });
}

/** `secret_hash` is deliberately not mapped. */
export function toOAuthClient(row: Row): OAuthClient {
  return freeze({
    clientId: str(row.client_id),
    tenantId: str(row.tenant_id),
    name: str(row.name),
    redirectUris: stringArray(row.redirect_uris),
    status: str(row.status) as OAuthClient["status"],
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  });
}

export function toAuditEntry(row: Row): AuditEntry {
  return freeze({
    id: str(row.id),
    seq: int(row.seq),
    tenantId: str(row.tenant_id),
    orgId: strOrNull(row.org_id),
    actorKind: str(row.actor_kind) as AuditEntry["actorKind"],
    actorUserId: strOrNull(row.actor_user_id),
    action: str(row.action),
    targetKind: strOrNull(row.target_kind),
    targetId: strOrNull(row.target_id),
    reasonCode: strOrNull(row.reason_code),
    before: jsonOrNull(row.before),
    after: jsonOrNull(row.after),
    ip: strOrNull(row.ip),
    userAgent: strOrNull(row.user_agent),
    createdAt: iso(row.created_at),
  });
}
