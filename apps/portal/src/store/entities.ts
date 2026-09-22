/**
 * The rows, as the store hands them back.
 *
 * Split out of `./types.ts` so the contract file stays readable: this half is "what a row is",
 * that half is "what you can ask for". Every name mirrors a column in
 * `docs/internal/portal/schema.md` and `migrations/0002_core_tables.sql`; where a column holds
 * secret material (`token_hash`, `otp_hash`, `code_hash`, `state_hash`, `secret_hash`) there is
 * deliberately no field here at all, because it must never leave the store.
 */

/** Injected wherever a TTL or a window is computed in TypeScript. */
export interface Clock {
  now(): Date;
}

/** ISO-8601 UTC, e.g. `2026-09-21T04:05:06.007Z`. Lexicographic order == chronological order. */
export type Iso = string;

export type JsonObject = { readonly [key: string]: unknown };

export type TenantStatus = "active" | "suspended";
export type OrgStatus = "active" | "past_due" | "suspended";
export type OrgPlan = "free" | "business" | "enterprise";
export type UserStatus = "invited" | "active" | "disabled";
export type UserRole = "owner" | "admin" | "member";
export type DeviceStatus = "active" | "revoked";
export type DevicePlatform = "windows" | "macos" | "linux" | "android" | "ios" | "web";
/** `redeemed` is terminal. `device-code-login.md` is explicit that there is no `consumed`. */
export type DeviceCodeStatus = "pending" | "approved" | "denied" | "redeemed" | "expired";
export type OtpPurpose = "activate" | "portal_login";
export type ActorKind = "user" | "api_key" | "system" | "support";

/**
 * The fixed reason-code vocabulary from `device-code-login.md`, "Login checks and reason codes".
 * `ok` is the only non-denial. Anything outside this union is a bug, not an extension point.
 */
export type ReasonCode =
  | "ok"
  | "tenant_inactive"
  | "org_inactive"
  | "org_past_due"
  | "user_inactive"
  | "device_revoked"
  | "session_revoked"
  | "seat_cap_reached"
  | "refresh_reused"
  | "refresh_expired";

export type DenialReason = Exclude<ReasonCode, "ok">;

/** The one flag vocabulary (`schema.md`, "Plan gates are columns and flags"). */
export interface TenantFeatureFlags {
  readonly admin_console?: boolean;
  readonly usage_reports?: boolean;
  readonly audit_export?: boolean;
  readonly spend_caps?: boolean;
  readonly model_allowlist?: boolean;
  readonly sentinel_filtering?: boolean;
  readonly residency?: boolean;
  readonly allow_byo_key?: boolean;
  /** The one non-boolean flag: null = no SSO, a string names the tenant's OIDC provider. */
  readonly sso_provider?: string | null;
}

export interface Tenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly status: TenantStatus;
  readonly residency: string;
  readonly createdAt: Iso;
  readonly updatedAt: Iso;
  readonly suspendedAt: Iso | null;
}

export interface TenantConfig {
  readonly tenantId: string;
  readonly version: number;
  readonly branding: JsonObject;
  readonly modelAllowlist: readonly string[];
  readonly featureFlags: TenantFeatureFlags;
  readonly createdAt: Iso;
  readonly updatedAt: Iso;
}

export interface Org {
  readonly id: string;
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly status: OrgStatus;
  readonly plan: OrgPlan;
  readonly seatCap: number;
  readonly seatBand: number;
  readonly currency: "USD" | "IDR";
  readonly billingEmail: string | null;
  readonly pastDueSince: Iso | null;
  readonly featureFlags: TenantFeatureFlags;
  readonly createdAt: Iso;
  readonly updatedAt: Iso;
}

export interface User {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly email: string;
  readonly displayName: string | null;
  readonly status: UserStatus;
  readonly role: UserRole;
  readonly createdAt: Iso;
  readonly updatedAt: Iso;
  readonly deactivatedAt: Iso | null;
}

export interface Device {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  /** Client-minted and opaque to the server. Never the `did` claim -- that is `id`. */
  readonly installId: string;
  readonly label: string | null;
  readonly platform: DevicePlatform;
  readonly osVersion: string | null;
  readonly appVersion: string | null;
  readonly status: DeviceStatus;
  readonly firstSeenAt: Iso;
  readonly lastSeenAt: Iso;
  readonly revokedAt: Iso | null;
  readonly revokedReason: string | null;
}

export interface Session {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly scope: string;
  readonly createdAt: Iso;
  readonly lastSeenAt: Iso;
  readonly absoluteExpiresAt: Iso;
  readonly revokedAt: Iso | null;
  readonly revokedReason: string | null;
}

/** A row of the rotation chain. The token hash never leaves the store. */
export interface RefreshToken {
  readonly id: string;
  readonly tenantId: string;
  readonly sessionId: string;
  readonly generation: number;
  readonly createdAt: Iso;
  readonly expiresAt: Iso;
  readonly usedAt: Iso | null;
  readonly replacedBy: string | null;
  readonly revokedAt: Iso | null;
  readonly revokedReason: string | null;
}

export interface DeviceCode {
  readonly id: string;
  /** The one nullable tenant in the schema: minted before anyone has authenticated. */
  readonly tenantId: string | null;
  readonly userCode: string;
  readonly status: DeviceCodeStatus;
  readonly userId: string | null;
  readonly orgId: string | null;
  readonly deviceId: string | null;
  readonly sessionId: string | null;
  readonly installId: string | null;
  readonly platform: DevicePlatform | null;
  readonly clientName: string | null;
  readonly clientVersion: string | null;
  readonly requestedScope: string;
  readonly intervalSeconds: number;
  readonly pollCount: number;
  readonly lastPolledAt: Iso | null;
  readonly createdAt: Iso;
  readonly expiresAt: Iso;
  readonly approvedAt: Iso | null;
  readonly deniedAt: Iso | null;
  readonly usedAt: Iso | null;
}

export interface LoginOtp {
  readonly id: string;
  readonly tenantId: string;
  readonly email: string;
  readonly purpose: OtpPurpose;
  readonly attempts: number;
  readonly consumedAt: Iso | null;
  readonly createdAt: Iso;
  readonly expiresAt: Iso;
}

export interface AuthCode {
  readonly id: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly createdAt: Iso;
  readonly expiresAt: Iso;
  readonly consumedAt: Iso | null;
}

export interface OAuthClient {
  readonly clientId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly status: "active" | "revoked";
  readonly createdAt: Iso;
  readonly updatedAt: Iso;
}

export interface AuditEntry {
  readonly id: string;
  readonly seq: number;
  readonly tenantId: string;
  readonly orgId: string | null;
  readonly actorKind: ActorKind;
  readonly actorUserId: string | null;
  readonly action: string;
  readonly targetKind: string | null;
  readonly targetId: string | null;
  readonly reasonCode: string | null;
  readonly before: JsonObject | null;
  readonly after: JsonObject | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly createdAt: Iso;
}

