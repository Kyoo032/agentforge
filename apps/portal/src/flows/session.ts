/**
 * The three Bearer-authenticated endpoints: `GET /auth/session`, `POST /auth/logout`,
 * `GET /tenant/config`.
 *
 * Verification is signature + `exp` + `iss` and nothing else (`src/jwt/sign.ts`), then one
 * database read for the state the token cannot carry because it changes mid-token-life --
 * `sessions.revoked_at`, `devices.revoked_at`, `users.status`, `orgs.status`. That is the split
 * `device-code-login.md` draws under "What the gateway still checks in DB per /v1 call", and
 * `GET /auth/session` is explicitly the endpoint that is allowed to make it.
 *
 * A refusal here is `401` with a reason from the login table, never a 403 and never a body that
 * says which half of the check failed beyond that reason.
 */
import { verifyAccessToken, type AccessClaims } from "../jwt/sign";
import type { TenantFeatureFlags } from "../store/types";
import type { PortalRuntime } from "./context";
import type { PortalReason } from "./reasons";
import { revokeWebSessions } from "./web-session";

export type BearerResult =
  | { readonly ok: true; readonly claims: AccessClaims }
  | { readonly ok: false; readonly reason: PortalReason };

export function readBearer(headers: Readonly<Record<string, string | string[] | undefined>>): string | null {
  const raw = headers.authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(value.trim());
  return match ? match[1] : null;
}

export function authenticate(runtime: PortalRuntime, token: string | null): BearerResult {
  if (!token) {
    return { ok: false, reason: "invalid_request" };
  }
  const verified = verifyAccessToken(runtime.keys, token, {
    issuer: runtime.issuer,
    now: runtime.clock.now().getTime(),
  });
  if (!verified.ok) {
    // An expired token is `session_revoked` to the client either way: both mean "refresh now".
    return { ok: false, reason: verified.reason === "expired" ? "session_revoked" : "invalid_grant" };
  }
  return { ok: true, claims: verified.claims };
}

export interface SessionSummaryBody {
  readonly user: { readonly id: string; readonly email: string; readonly name: string | null };
  readonly org: {
    readonly id: string;
    readonly name: string;
    readonly status: string;
    readonly plan: string;
    readonly seat_cap: number;
    readonly seats_used: number;
  };
  readonly tenant: { readonly id: string; readonly slug: string };
  readonly device: { readonly id: string; readonly label: string | null; readonly last_seen_at: string };
  readonly session: { readonly id: string; readonly created_at: string };
}

export type SessionSummaryResult =
  | { readonly ok: true; readonly body: SessionSummaryBody }
  | { readonly ok: false; readonly reason: PortalReason };

export async function describeSession(
  runtime: PortalRuntime,
  claims: AccessClaims,
): Promise<SessionSummaryResult> {
  return runtime.store.tx(claims.tid, async (ops) => {
    const session = await ops.sessions.findById(claims.sid);
    if (!session || session.revokedAt !== null) {
      return { ok: false as const, reason: "session_revoked" as const };
    }
    const reason = await ops.loginPrecheck({
      userId: claims.sub,
      deviceId: claims.did,
      sessionId: claims.sid,
    });
    if (reason !== "ok") {
      return { ok: false as const, reason: reason as PortalReason };
    }

    const [user, org, tenant, device] = await Promise.all([
      ops.users.findById(claims.sub),
      ops.orgs.findById(claims.oid),
      ops.tenants.findById(claims.tid),
      ops.devices.findById(claims.did),
    ]);
    if (!user || !org || !tenant || !device) {
      return { ok: false as const, reason: "session_revoked" as const };
    }
    const seatsUsed = await ops.orgs.countActiveUsers(org.id);

    // `last_seen_at` slides here rather than on every /v1 call: this endpoint is called after
    // login and on the Account screen, which is the cadence the seat window wants.
    await ops.sessions.touch(claims.sid);

    return {
      ok: true as const,
      body: Object.freeze({
        user: { id: user.id, email: user.email, name: user.displayName },
        org: {
          id: org.id,
          name: org.name,
          status: org.status,
          plan: org.plan,
          seat_cap: org.seatCap,
          seats_used: seatsUsed,
        },
        tenant: { id: tenant.id, slug: tenant.slug },
        device: { id: device.id, label: device.label, last_seen_at: device.lastSeenAt },
        session: { id: session.id, created_at: session.createdAt },
      }),
    };
  });
}

/**
 * Idempotent by contract: always 204. A session that was already revoked, or that never existed
 * under this tenant, is the same answer -- "you are signed out" is not information anyone can use.
 *
 * `all_devices` also ends the portal's own browser sessions (SR-21). That is the one caller whose
 * stated meaning is already "everywhere", and before this it left the 30-day portal cookie alone --
 * so "sign me out of everything" still let the next visitor press Sign in and be signed straight
 * back in as the person who had just left. A single-session logout does **not** bump the counter:
 * it would sign the person out of browsers they never touched, and the browser they did touch has
 * its cookie cleared by `POST /logout`.
 */
export async function revokeSession(
  runtime: PortalRuntime,
  claims: AccessClaims,
  allDevices: boolean,
): Promise<void> {
  await runtime.store.tx(claims.tid, async (ops) => {
    if (allDevices) {
      await ops.sessions.revokeAllForUser(claims.sub, "logout");
      await revokeWebSessions(ops, { tenantId: claims.tid, orgId: claims.oid, userId: claims.sub });
    } else {
      await ops.sessions.revoke(claims.sid, "logout");
    }
    await ops.audit.append({
      tenantId: claims.tid,
      orgId: claims.oid,
      actorKind: "user",
      actorUserId: claims.sub,
      action: "session.revoked",
      targetKind: "session",
      targetId: claims.sid,
      after: { all_devices: allDevices },
    });
  });
}

export interface TenantConfigBody {
  readonly tenant_id: string;
  readonly slug: string;
  readonly etag: string;
  readonly branding: Readonly<Record<string, unknown>>;
  readonly model_allowlist?: readonly string[];
  /** The one flag vocabulary from `schema.md`; `sso_provider` is the only non-boolean. */
  readonly feature_flags?: TenantFeatureFlags;
}

export type TenantConfigResult =
  | { readonly ok: true; readonly body: TenantConfigBody; readonly etag: string }
  | { readonly ok: false; readonly reason: PortalReason };

/**
 * Two callers, two answers. A Bearer token gets the whole document; `?tenant=<slug>` is the
 * pre-login branding hop and gets **branding only** -- never the flags and never the allowlist,
 * because that URL is unauthenticated and the flags name what a tenant has bought.
 */
export async function readTenantConfig(
  runtime: PortalRuntime,
  input: { readonly tenantId: string; readonly authenticated: boolean },
): Promise<TenantConfigResult> {
  return runtime.store.tx(input.tenantId, async (ops) => {
    const [tenant, config] = await Promise.all([
      ops.tenants.findById(input.tenantId),
      ops.tenantConfig.get(input.tenantId),
    ]);
    if (tenant?.status !== "active") {
      return { ok: false as const, reason: "tenant_inactive" as const };
    }
    const etag = `W/"${config?.version ?? 0}"`;
    return {
      ok: true as const,
      etag,
      body: Object.freeze({
        tenant_id: tenant.id,
        slug: tenant.slug,
        etag,
        branding: config?.branding ?? {},
        ...(input.authenticated
          ? {
              model_allowlist: config?.modelAllowlist ?? [],
              feature_flags: config?.featureFlags ?? {},
            }
          : {}),
      }),
    };
  });
}
