/**
 * The portal's store contract.
 *
 * Every name and every rule here mirrors `docs/internal/portal/schema.md` and
 * `docs/internal/portal/migrations/0001-0005`, which the one driver (`./postgres/**`) applies
 * unchanged. Where those files are missing something the browser login needs, the gap is closed by
 * `apps/portal/migrations/0006-0007` in the same style, never by editing theirs.
 *
 * The row shapes live in `./entities.ts` and are re-exported here, so importing this file gets the
 * whole contract.
 *
 * Four invariants hold for every implementation:
 *
 *  1. **Raw codes and tokens are never stored.** Only `sha256(raw)` reaches a row. The raw value
 *     exists in the caller's hand and in the e-mail, and nowhere else.
 *  2. **Every returned value is deeply frozen.** Callers read rows; they never reach in and mutate
 *     one and expect the store to notice.
 *  3. **The tenant scope is explicit.** `tx(tenantId, fn)` is the only way to reach a row, because
 *     `SET LOCAL app.tenant_id` is what every RLS policy in 0004 reads, and `SET LOCAL` is only
 *     meaningful inside a transaction. `tx(null, fn)` is the pre-authentication window: it reaches
 *     exactly the two tables whose policies expose it (`device_codes`, `oauth_clients`) and fails
 *     closed everywhere else. That is the documented behaviour, not a limitation to work around --
 *     the way in is `resolve.*`, the SECURITY DEFINER resolvers in 0007.
 *  4. **Time comes from the injected `Clock`** for every TTL this code computes. The plpgsql
 *     functions in 0005 compare against the database's own `now()`, so a fake clock must stay
 *     near real time; a test that needs an expired row asks for a negative TTL instead of
 *     travelling.
 */
import type {
  ApproveDeviceCodeInput,
  ApproveDeviceCodeResult,
  AppendAuditInput,
  AuditEntry,
  AuthCode,
  Clock,
  ConsumeAuthCodeInput,
  ConsumeAuthCodeResult,
  CreateDeviceCodeInput,
  CreateOAuthClientInput,
  CreateOrgInput,
  CreateSessionInput,
  CreateTenantInput,
  CreateUserInput,
  DenyDeviceCodeResult,
  Device,
  DeviceCode,
  IssueAuthCodeInput,
  IssueRefreshTokenInput,
  LoginPrecheckInput,
  OAuthClient,
  Org,
  OrgStatus,
  PollDeviceCodeResult,
  RedeemDeviceCodeInput,
  ReasonCode,
  RefreshToken,
  RotateRefreshTokenInput,
  RotateRefreshTokenResult,
  SendLoginOtpInput,
  SendLoginOtpResult,
  Session,
  Tenant,
  TenantConfig,
  TenantStatus,
  UpsertDeviceInput,
  UpsertDeviceResult,
  UpsertTenantConfigInput,
  User,
  UserStatus,
  VerifyLoginOtpInput,
  VerifyLoginOtpResult,
} from "./inputs";

export * from "./entities";
export * from "./inputs";

// ---------------------------------------------------------------------------
// Operations, inside one tenant-scoped transaction
// ---------------------------------------------------------------------------

export interface PortalOps {
  readonly tenants: {
    create(input: CreateTenantInput): Promise<Tenant>;
    findById(id: string): Promise<Tenant | null>;
    findBySlug(slug: string): Promise<Tenant | null>;
    setStatus(id: string, status: TenantStatus): Promise<Tenant | null>;
    /**
     * The DISPLAY name. The slug is the identity and never changes; this is what a person reads,
     * and `otp/product-name.ts` prints it when the tenant has chosen one. `pnpm portal:seed
     * --tenant-name` is the supported way to correct it on a tenant that already exists.
     */
    setName(id: string, name: string): Promise<Tenant | null>;
  };

  readonly tenantConfig: {
    get(tenantId: string): Promise<TenantConfig | null>;
    /** Bumps `version` on every write, so the client can be told "unchanged". */
    upsert(input: UpsertTenantConfigInput): Promise<TenantConfig>;
  };

  readonly orgs: {
    create(input: CreateOrgInput): Promise<Org>;
    findById(id: string): Promise<Org | null>;
    findBySlug(tenantId: string, slug: string): Promise<Org | null>;
    setStatus(id: string, status: OrgStatus): Promise<Org | null>;
    setSeatCap(id: string, seatCap: number): Promise<Org | null>;
    /** `count_active_users(uuid)` from 0005, called, not re-implemented. */
    countActiveUsers(orgId: string): Promise<number>;
  };

  readonly users: {
    create(input: CreateUserInput): Promise<User>;
    findById(id: string): Promise<User | null>;
    findByEmail(tenantId: string, email: string): Promise<User | null>;
    setStatus(id: string, status: UserStatus): Promise<User | null>;
  };

  readonly devices: {
    /** Upsert on `(user_id, install_id)`. A revoked row is refused. */
    upsert(input: UpsertDeviceInput): Promise<UpsertDeviceResult>;
    findById(id: string): Promise<Device | null>;
    findByInstall(userId: string, installId: string): Promise<Device | null>;
    revoke(id: string, reason: string): Promise<Device | null>;
    touch(id: string): Promise<void>;
  };

  readonly sessions: {
    create(input: CreateSessionInput): Promise<Session>;
    findById(id: string): Promise<Session | null>;
    listLiveForUser(userId: string): Promise<readonly Session[]>;
    /** `revoke_session_chain` from 0005: the session, its whole chain, and one audit row. */
    revoke(id: string, reason: string): Promise<Session | null>;
    revokeAllForUser(userId: string, reason: string): Promise<number>;
    revokeAllForDevice(deviceId: string, reason: string): Promise<number>;
    touch(id: string, ip?: string | null, userAgent?: string | null): Promise<void>;
  };

  readonly refreshTokens: {
    /** Generation 1 under a fresh session. */
    issue(input: IssueRefreshTokenInput): Promise<RefreshToken>;
    /** `rotate_refresh_token(...)` from 0005. Only legal once `app.tenant_id` is set. */
    rotate(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult>;
    listForSession(sessionId: string): Promise<readonly RefreshToken[]>;
  };

  readonly deviceCodes: {
    create(input: CreateDeviceCodeInput): Promise<DeviceCode>;
    findByUserCode(userCode: string): Promise<DeviceCode | null>;
    approve(input: ApproveDeviceCodeInput): Promise<ApproveDeviceCodeResult>;
    deny(userCode: string): Promise<DenyDeviceCodeResult>;
    /** Counts the poll, applies `slow_down` and the 200-poll ceiling, then reports the state. */
    poll(rawDeviceCode: string, installId: string): Promise<PollDeviceCodeResult>;
    /** Single use: `redeemed` + `used_at` + `session_id`, in the caller's transaction. */
    redeem(input: RedeemDeviceCodeInput): Promise<DeviceCode | null>;
    /** `expire_device_codes()` from 0005. */
    expireDue(): Promise<number>;
  };

  readonly loginOtps: {
    send(input: SendLoginOtpInput): Promise<SendLoginOtpResult>;
    verify(input: VerifyLoginOtpInput): Promise<VerifyLoginOtpResult>;
    /** `prune_login_otps()` from 0005: keeps 24 h so the send window stays countable. */
    prune(): Promise<number>;
  };

  readonly authCodes: {
    issue(input: IssueAuthCodeInput): Promise<AuthCode>;
    consume(input: ConsumeAuthCodeInput): Promise<ConsumeAuthCodeResult>;
  };

  readonly oauthClients: {
    create(input: CreateOAuthClientInput): Promise<OAuthClient>;
    findByClientId(clientId: string): Promise<OAuthClient | null>;
    /** Constant-time compare of sha256(secret). */
    verifySecret(clientId: string, secret: string): Promise<boolean>;
    rotateSecret(clientId: string, secret: string): Promise<OAuthClient | null>;
    /**
     * Replace the redirect allowlist. Separate from `rotateSecret` on purpose: a deployment that
     * gains a second public origin — the review instance behind a tunnel is the first one — has to
     * register that callback **without** invalidating the secret every running process already
     * holds. The caller decides the whole list; nothing here merges, so a removal stays expressible.
     */
    setRedirectUris(clientId: string, redirectUris: readonly string[]): Promise<OAuthClient | null>;
    allowsRedirect(clientId: string, redirectUri: string): Promise<boolean>;
  };

  /**
   * The portal's own browser session, which is a signed cookie rather than a row
   * (`src/security/web-session.ts`). This is the one piece of it that is server-side: a per-user
   * version counter the cookie carries, so a revocation takes effect on the next request (SR-21).
   */
  readonly webSessions: {
    /** The live version for a user. **No row means 1** — nothing is back-filled. */
    version(userId: string): Promise<number>;
    /** Bump it, ending every portal browser session that user holds. Returns the new version. */
    revoke(input: { readonly userId: string; readonly tenantId: string }): Promise<number>;
  };

  readonly audit: {
    append(input: AppendAuditInput): Promise<AuditEntry>;
    list(filter?: {
      readonly tenantId?: string;
      readonly action?: string;
      readonly limit?: number;
    }): Promise<readonly AuditEntry[]>;
  };

  /** `login_precheck(uuid, uuid, uuid)` from 0005, with its advisory lock. */
  loginPrecheck(input: LoginPrecheckInput): Promise<ReasonCode>;
}

/**
 * The pre-authentication resolvers (`apps/portal/migrations/0007_tenant_resolvers.sql`).
 * Each answers at most a tenant id, so none of them confirms that a code, a token or an address
 * is valid to a caller who does not already hold it.
 */
export interface TenantResolvers {
  bySlug(slug: string): Promise<string | null>;
  /** NULL when the address is unknown **or** matches users in more than one tenant. */
  byEmail(email: string): Promise<string | null>;
  byRefreshToken(rawToken: string): Promise<string | null>;
  byDeviceCode(rawDeviceCode: string): Promise<string | null>;
  byUserCode(userCode: string): Promise<string | null>;
  byAuthCode(rawCode: string): Promise<string | null>;
  byClientId(clientId: string): Promise<string | null>;
}

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly skipped: readonly string[];
}

export interface PortalStore {
  readonly clock: Clock;
  /**
   * One transaction with `SET LOCAL app.tenant_id`. `null` opens the pre-authentication window.
   * The callback's return value is passed through; a throw rolls the transaction back.
   */
  tx<T>(tenantId: string | null, fn: (ops: PortalOps) => Promise<T>): Promise<T>;
  readonly resolve: TenantResolvers;
  /** Applies 0001-0005 (theirs, unchanged) then 0006+ (ours), idempotently. */
  migrate(): Promise<MigrationResult>;
  close(): Promise<void>;

  /**
   * Refresh arrives with no `tid` -- the client sends a token and a device id and nothing else.
   * So this one composes the resolver with the scoped transaction, which is the sequence the
   * refresh handler must not get wrong.
   */
  rotateRefreshToken(input: RotateRefreshTokenInput): Promise<RotateRefreshTokenResult>;
  /** Same shape: the polling app holds a device code and knows no tenant. */
  pollDeviceCode(rawDeviceCode: string, installId: string): Promise<PollDeviceCodeResult>;
}
