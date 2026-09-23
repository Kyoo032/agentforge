/**
 * `POST /auth/token` -- the only endpoint the product calls to get a session, and the only one
 * whose response shape is read field-by-field somewhere else.
 *
 * The success body is **exactly** what `toTokens` in `packages/host/src/auth/portal-client.ts`
 * parses: `access_token, refresh_token, session_id, user_id, org_id, tenant_id` are required and a
 * missing one makes the host raise `portal_unavailable`; `expires_in`, `refresh_expires_in` and
 * `device_id` are optional and all three are sent. `src/routes/routes.test.ts` pins the exact key
 * set, because "the portal answered 200 and the app still could not sign in" is the failure this
 * prevents.
 *
 * Two grants:
 *
 *   - `authorization_code` -- the browser flow. Single use, 60 s, bound to the client and the
 *     `redirect_uri` it was issued for. **The client secret is verified before the code is
 *     consumed**, so a wrong secret cannot burn a legitimate user's code.
 *   - `refresh_token` -- rotation and reuse detection, both inside `rotate_refresh_token`
 *     (`0005_functions.sql`). The successor token is generated here and passed in as
 *     `p_new_token_hash`; the database never sees a raw token in either direction.
 */
import { randomToken } from "../crypto";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken } from "../jwt/sign";
import type { Clock, PortalOps, TenantFeatureFlags } from "../store/types";
import type { PortalRuntime } from "./context";
import { runBrowserLoginGate, webInstallId, auditLoginDenied } from "./login";
import type { PortalReason } from "./reasons";

export interface TokenResponseBody {
  readonly access_token: string;
  readonly token_type: "Bearer";
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly refresh_expires_in: number;
  readonly session_id: string;
  readonly device_id: string;
  readonly user_id: string;
  readonly org_id: string;
  readonly tenant_id: string;
}

export type TokenResult =
  | { readonly ok: true; readonly body: TokenResponseBody }
  | { readonly ok: false; readonly reason: PortalReason };

/**
 * "`scope` is coarse and is set from `tenant_config.feature_flags` at issue time"
 * (`device-code-login.md`, Token design). Chat and models are what every tenant gets.
 */
export function scopeFor(flags: TenantFeatureFlags | undefined): string {
  const scopes = ["v1.chat", "v1.models"];
  if (flags?.usage_reports) {
    scopes.push("v1.usage");
  }
  return scopes.join(" ");
}

function secondsUntil(iso: string, clock: Clock): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - clock.now().getTime()) / 1000));
}

export interface AuthorizationCodeGrant {
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function exchangeAuthorizationCode(
  runtime: PortalRuntime,
  grant: AuthorizationCodeGrant,
): Promise<TokenResult> {
  const tenantId = await runtime.store.resolve.byAuthCode(grant.code);
  if (!tenantId) {
    // Unknown code. No audit row: there is no tenant to write it against, and audit_log.tenant_id
    // is NOT NULL. The rate limiter on this route is what bounds guessing.
    return { ok: false, reason: "invalid_grant" };
  }

  return runtime.store.tx(tenantId, async (ops) => {
    const authenticated = await ops.oauthClients.verifySecret(grant.clientId, grant.clientSecret);
    if (!authenticated) {
      await ops.audit.append({
        tenantId,
        actorKind: "system",
        action: "token.client_auth_failed",
        targetKind: "oauth_client",
        // `audit_log.target_id` is a uuid column and `oauth_clients.client_id` is text, so the
        // client goes in `after` rather than being cast into a column it does not fit.
        after: { client_id: grant.clientId },
        reasonCode: "invalid_client",
        ip: grant.ip ?? null,
      });
      return { ok: false as const, reason: "invalid_client" as const };
    }

    const consumed = await ops.authCodes.consume({
      rawCode: grant.code,
      clientId: grant.clientId,
      redirectUri: grant.redirectUri,
    });
    if (!consumed.ok) {
      await ops.audit.append({
        tenantId,
        actorKind: "system",
        action: consumed.reason === "already_used" ? "auth_code.replayed" : "auth_code.rejected",
        targetKind: "auth_code",
        reasonCode: consumed.reason,
        ip: grant.ip ?? null,
      });
      return { ok: false as const, reason: "invalid_grant" as const };
    }

    const user = await ops.users.findById(consumed.code.userId);
    if (!user) {
      return { ok: false as const, reason: "invalid_grant" as const };
    }

    const gate = await runBrowserLoginGate(ops, {
      tenantId,
      user,
      installId: webInstallId(grant.clientId),
    });
    if (!gate.ok) {
      await auditLoginDenied(ops, {
        tenantId,
        orgId: user.orgId,
        userId: user.id,
        reason: gate.reason,
        ip: grant.ip ?? null,
      });
      return { ok: false as const, reason: gate.reason };
    }

    return mintSession(runtime, ops, {
      tenantId,
      orgId: user.orgId,
      userId: user.id,
      deviceId: gate.device.id,
      ip: grant.ip ?? null,
      userAgent: grant.userAgent ?? null,
    });
  });
}

export interface MintSessionInput {
  readonly tenantId: string;
  readonly orgId: string;
  readonly userId: string;
  readonly deviceId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

/**
 * The shared tail of every successful sign-in: one `sessions` row, one generation-1 refresh token,
 * one access token, one `session.created` audit row -- all in the caller's transaction, which is
 * what makes the seat check `login_precheck` just did atomic against a concurrent login.
 */
export async function mintSession(
  runtime: PortalRuntime,
  ops: PortalOps,
  input: MintSessionInput,
): Promise<TokenResult> {
  const config = await ops.tenantConfig.get(input.tenantId);
  const scope = scopeFor(config?.featureFlags);

  const session = await ops.sessions.create({
    tenantId: input.tenantId,
    orgId: input.orgId,
    userId: input.userId,
    deviceId: input.deviceId,
    scope,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  const refreshToken = randomToken();
  const refresh = await ops.refreshTokens.issue({ sessionId: session.id, rawToken: refreshToken });

  await ops.audit.append({
    tenantId: input.tenantId,
    orgId: input.orgId,
    actorKind: "user",
    actorUserId: input.userId,
    action: "session.created",
    targetKind: "session",
    targetId: session.id,
    after: { device_id: input.deviceId, scope },
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  const accessToken = signAccessToken(runtime.keys.current, {
    issuer: runtime.issuer,
    userId: input.userId,
    tenantId: input.tenantId,
    orgId: input.orgId,
    deviceId: input.deviceId,
    sessionId: session.id,
    scope,
    now: runtime.clock.now().getTime(),
  });

  return {
    ok: true,
    body: Object.freeze({
      access_token: accessToken,
      token_type: "Bearer" as const,
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      refresh_expires_in: secondsUntil(refresh.expiresAt, runtime.clock),
      session_id: session.id,
      device_id: input.deviceId,
      user_id: input.userId,
      org_id: input.orgId,
      tenant_id: input.tenantId,
    }),
  };
}

export interface ClientCredentials {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly ip?: string | null;
}

/**
 * A confidential client proving it is one, before a refresh. The refresh token is still the
 * credential for the refresh itself; what this decides is whose rate-limit bucket the refresh is
 * counted in (`routes/tokens.ts`). A wrong secret is audited exactly as the code grant audits it,
 * against the client's own tenant. An unknown client has no tenant, and `audit_log.tenant_id` is
 * NOT NULL, so it is not audited.
 */
export async function authenticateClient(
  runtime: PortalRuntime,
  credentials: ClientCredentials,
): Promise<{ readonly ok: boolean }> {
  const tenantId = await runtime.store.resolve.byClientId(credentials.clientId);
  if (!tenantId) {
    return { ok: false };
  }
  return runtime.store.tx(tenantId, async (ops) => {
    if (await ops.oauthClients.verifySecret(credentials.clientId, credentials.clientSecret)) {
      return { ok: true };
    }
    await ops.audit.append({
      tenantId,
      actorKind: "system",
      action: "token.client_auth_failed",
      targetKind: "oauth_client",
      after: { client_id: credentials.clientId, grant_type: "refresh_token" },
      reasonCode: "invalid_client",
      ip: credentials.ip ?? null,
    });
    return { ok: false };
  });
}

export interface RefreshGrant {
  readonly refreshToken: string;
  /**
   * `devices.id`, required. `rotate_refresh_token` skips the device binding when this is NULL, so an
   * optional field here would be an optional binding (`routes/tokens.ts` refuses a refresh without
   * one).
   */
  readonly deviceId: string;
  readonly ip?: string | null;
  readonly userAgent?: string | null;
}

export async function exchangeRefreshToken(
  runtime: PortalRuntime,
  grant: RefreshGrant,
): Promise<TokenResult> {
  // Read 32 random bytes, keep the base64url form for the client, hand the hash to the function.
  const successor = randomToken();
  const rotated = await runtime.store.rotateRefreshToken({
    presentedToken: grant.refreshToken,
    newToken: successor,
    deviceId: grant.deviceId,
    ip: grant.ip ?? null,
    userAgent: grant.userAgent ?? null,
  });

  if (rotated.reason !== "ok") {
    if (rotated.tenantId) {
      await runtime.store.tx(rotated.tenantId, (ops) =>
        ops.audit.append({
          tenantId: rotated.tenantId as string,
          actorKind: "system",
          action: rotated.reason === "refresh_reused" ? "token.reuse_detected" : "token.refresh_denied",
          targetKind: "session",
          targetId: rotated.sessionId,
          reasonCode: rotated.reason,
          ip: grant.ip ?? null,
        }),
      );
    }
    return { ok: false, reason: rotated.reason };
  }

  return runtime.store.tx(rotated.tenantId, async (ops) => {
    const config = await ops.tenantConfig.get(rotated.tenantId);
    const scope = scopeFor(config?.featureFlags);

    await ops.audit.append({
      tenantId: rotated.tenantId,
      orgId: rotated.orgId,
      actorKind: "user",
      actorUserId: rotated.userId,
      action: "token.refreshed",
      targetKind: "session",
      targetId: rotated.sessionId,
      after: { generation: rotated.generation },
      ip: grant.ip ?? null,
    });

    const accessToken = signAccessToken(runtime.keys.current, {
      issuer: runtime.issuer,
      userId: rotated.userId,
      tenantId: rotated.tenantId,
      orgId: rotated.orgId,
      deviceId: rotated.deviceId,
      sessionId: rotated.sessionId,
      scope,
      now: runtime.clock.now().getTime(),
    });

    return {
      ok: true as const,
      body: Object.freeze({
        access_token: accessToken,
        token_type: "Bearer" as const,
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: successor,
        refresh_expires_in: secondsUntil(rotated.expiresAt, runtime.clock),
        session_id: rotated.sessionId,
        device_id: rotated.deviceId,
        user_id: rotated.userId,
        org_id: rotated.orgId,
        tenant_id: rotated.tenantId,
      }),
    };
  });
}
