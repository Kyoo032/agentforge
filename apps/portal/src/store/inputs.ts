/**
 * What you can ask the store for, and what it answers.
 *
 * Split out of `./types.ts` so each file stays readable: `./entities.ts` is "what a row is", this
 * is "what you can ask for", and `./types.ts` is the store itself. Every result is a discriminated
 * union rather than a throw, because a denial here is an expected outcome with a reason code the
 * caller has to branch on -- `device-code-login.md`, "Login checks and reason codes".
 */

import type {
  ActorKind,
  AuthCode,
  DenialReason,
  Device,
  DeviceCode,
  DevicePlatform,
  Iso,
  JsonObject,
  LoginOtp,
  OrgPlan,
  OtpPurpose,
  TenantFeatureFlags,
  TenantStatus,
  UserRole,
  UserStatus,
} from "./entities";

export * from "./entities";


// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateTenantInput {
  /**
   * Pre-minted by the caller so `tx(id, …)` can scope the very transaction that inserts the row:
   * the `tenants` policy in 0004 is `WITH CHECK (id = app_tenant_id())`, so a tenant cannot be
   * created by a tenant-scoped connection without knowing its id first. Defaults to a fresh uuid.
   */
  readonly id?: string;
  readonly slug: string;
  readonly name: string;
  readonly status?: TenantStatus;
  readonly residency?: string;
}

export interface UpsertTenantConfigInput {
  readonly tenantId: string;
  readonly branding?: JsonObject;
  readonly modelAllowlist?: readonly string[];
  readonly featureFlags?: TenantFeatureFlags;
}

export interface CreateOrgInput {
  readonly tenantId: string;
  readonly name: string;
  readonly slug: string;
  readonly plan?: OrgPlan;
  readonly seatCap?: number;
  readonly seatBand?: number;
  readonly currency?: "USD" | "IDR";
  readonly billingEmail?: string | null;
  readonly featureFlags?: TenantFeatureFlags;
}

export interface CreateUserInput {
  readonly tenantId: string;
  readonly orgId: string;
  readonly email: string;
  readonly displayName?: string | null;
  readonly status?: UserStatus;
  readonly role?: UserRole;
}

export interface UpsertDeviceInput {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly installId: string;
  readonly platform: DevicePlatform;
  readonly label?: string | null;
  readonly osVersion?: string | null;
  readonly appVersion?: string | null;
}

/** A revoked install is refused, never resurrected: an admin has to clear it first. */
export type UpsertDeviceResult =
  | { readonly ok: true; readonly device: Device }
  | { readonly ok: false; readonly reason: "device_revoked"; readonly device: Device };

export interface CreateSessionInput {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly scope?: string;
  /** Defaults to the schema's 90-day ceiling. */
  readonly absoluteTtlMs?: number;
  /**
   * Defaults to now. Set explicitly only by a data import or a test that needs a session outside
   * the 30-day seat window -- the seat count is the one thing this column drives.
   */
  readonly lastSeenAt?: Iso;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface IssueRefreshTokenInput {
  readonly sessionId: string;
  /** The caller generated it and keeps the raw form; only the hash is stored. */
  readonly rawToken: string;
  readonly ttlMs?: number;
}

export interface RotateRefreshTokenInput {
  /** The raw token the client just presented. */
  readonly presentedToken: string;
  /** The raw successor the caller generated a moment ago -- `p_new_token_hash`, not optional. */
  readonly newToken: string;
  /** `devices.id`, compared against `sessions.device_id`. Omitting it skips the binding entirely. */
  readonly deviceId?: string | null;
  readonly ttlMs?: number;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export type RotateRefreshTokenResult =
  | {
      readonly reason: "ok";
      readonly sessionId: string;
      readonly tenantId: string;
      readonly orgId: string;
      readonly userId: string;
      readonly deviceId: string;
      readonly newTokenId: string;
      readonly generation: number;
      readonly expiresAt: Iso;
    }
  | {
      readonly reason: DenialReason;
      readonly sessionId: string | null;
      readonly tenantId: string | null;
    };

export interface CreateDeviceCodeInput {
  readonly rawDeviceCode: string;
  readonly installId: string;
  readonly platform?: DevicePlatform | null;
  readonly tenantId?: string | null;
  readonly clientName?: string | null;
  readonly clientVersion?: string | null;
  readonly requestedScope?: string;
  readonly ttlMs?: number;
  readonly intervalSeconds?: number;
  readonly createdIp?: string | null;
}

export interface ApproveDeviceCodeInput {
  readonly userCode: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly approvedIp?: string | null;
}

export type ApproveDeviceCodeResult =
  | { readonly ok: true; readonly code: DeviceCode }
  | { readonly ok: false; readonly reason: "device_code_expired" | "tenant_inactive" };

export type DenyDeviceCodeResult =
  | { readonly ok: true; readonly code: DeviceCode }
  | { readonly ok: false; readonly reason: "device_code_expired" };

/**
 * One poll of `/auth/device/token`, with the counters the login doc names: more than 2 polls
 * inside one `intervalSeconds` window answers `slow_down` and widens the interval by 5 s; more
 * than 200 polls on one code force-expires it.
 */
export type PollDeviceCodeResult =
  | { readonly reason: "ok"; readonly code: DeviceCode }
  | { readonly reason: "authorization_pending"; readonly intervalSeconds: number }
  | { readonly reason: "slow_down"; readonly intervalSeconds: number; readonly retryAfter: number }
  | { readonly reason: "device_code_expired" }
  | { readonly reason: "device_code_denied" }
  /** Unknown hash, an install_id that does not match, or a code already redeemed. */
  | { readonly reason: "invalid_grant" };

export interface RedeemDeviceCodeInput {
  readonly rawDeviceCode: string;
  readonly sessionId: string;
}

export interface SendLoginOtpInput {
  readonly tenantId: string;
  readonly email: string;
  /** The raw 6 digits. Only sha256 is stored. */
  readonly code: string;
  readonly purpose?: OtpPurpose;
  readonly ttlMs?: number;
  readonly createdIp?: string | null;
}

export type SendLoginOtpResult =
  | { readonly ok: true; readonly otp: LoginOtp }
  /** 3 sends per 15 minutes per address, counted from the rows themselves. */
  | { readonly ok: false; readonly reason: "send_rate_limited"; readonly retryAfter: number };

export interface VerifyLoginOtpInput {
  readonly tenantId: string;
  readonly email: string;
  readonly code: string;
  readonly purpose?: OtpPurpose;
}

export type VerifyLoginOtpResult =
  | { readonly ok: true; readonly otp: LoginOtp }
  | {
      readonly ok: false;
      /**
       * `too_many_attempts`: this code has taken its five guesses. `locked`: the ADDRESS has taken
       * twenty guesses in the last 24 hours, across every code and both purposes, so even the
       * right code on a fresh code is refused until they age out.
       */
      readonly reason: "no_code" | "expired" | "too_many_attempts" | "invalid_code" | "locked";
      readonly attemptsRemaining: number;
    };

export interface IssueAuthCodeInput {
  readonly rawCode: string;
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly clientId: string;
  readonly redirectUri: string;
  /**
   * Stored as sha256 only, for audit — never compared (SR-43). The login-CSRF binding on `state`
   * is the host's own `__Host-` cookie check, which runs before `/auth/token` is called.
   */
  readonly state: string;
  readonly ttlMs?: number;
  readonly createdIp?: string | null;
}

export interface ConsumeAuthCodeInput {
  readonly rawCode: string;
  readonly clientId: string;
  readonly redirectUri: string;
}

export type ConsumeAuthCodeResult =
  | { readonly ok: true; readonly code: AuthCode }
  | {
      readonly ok: false;
      readonly reason:
        | "invalid_grant"
        | "expired"
        | "already_used"
        | "client_mismatch"
        | "redirect_mismatch";
    };

export interface CreateOAuthClientInput {
  readonly clientId: string;
  readonly tenantId: string;
  readonly name: string;
  /** The raw secret. Only sha256 is stored, and the operator sees it once. */
  readonly secret: string;
  readonly redirectUris: readonly string[];
}

export interface AppendAuditInput {
  /** NOT NULL in `0003_billing_and_usage.sql`: an event with no resolved tenant is not written. */
  readonly tenantId: string;
  readonly orgId?: string | null;
  readonly actorKind: ActorKind;
  readonly actorUserId?: string | null;
  readonly action: string;
  readonly targetKind?: string | null;
  readonly targetId?: string | null;
  readonly reasonCode?: string | null;
  readonly before?: JsonObject | null;
  readonly after?: JsonObject | null;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export interface LoginPrecheckInput {
  readonly userId: string;
  readonly deviceId: string;
  /** NULL on a brand-new session, which is the only path that charges a seat. */
  readonly sessionId?: string | null;
}

