/**
 * The portal's own browser session, on the flow side: mint it, check it is still live, end it.
 *
 * `src/security/web-session.ts` owns the cookie's bytes — payload, HMAC, TTL. This owns the one
 * thing that needs the database: the per-user version counter that makes a signed cookie
 * revocable (`apps/portal/migrations/0009_web_session_revocation.sql`, SR-21).
 *
 * The rule every caller follows: **a cookie is not a session until its version has been checked**
 * inside the tenant's own scope. `readWebSession` proves the cookie is ours and unexpired; only
 * `webSessionIsLive` (or the same read inside a transaction the caller already has) proves it has
 * not been revoked since.
 */
import { serialiseCookie } from "../security/cookies";
import { WEB_SESSION_TTL_MS, mintWebSession, type WebSession } from "../security/web-session";
import type { PortalOps } from "../store/types";
import type { PortalRuntime } from "./context";

export interface NewWebSession {
  readonly tenantId: string;
  readonly userId: string;
  readonly orgId: string;
  readonly installId: string;
}

/** `Set-Cookie` for a fresh session, stamped with the version it was minted under. */
export function webSessionCookie(runtime: PortalRuntime, session: NewWebSession, version: number): string {
  return serialiseCookie(
    runtime.cookies.session,
    mintWebSession(runtime.webSecret, { ...session, ver: version }, runtime.clock.now().getTime()),
    { secure: runtime.secureCookies, maxAgeSeconds: Math.floor(WEB_SESSION_TTL_MS / 1000) },
  );
}

/** The same, reading the live version inside the caller's transaction. */
export async function webSessionCookieFor(
  runtime: PortalRuntime,
  ops: PortalOps,
  session: NewWebSession,
): Promise<string> {
  return webSessionCookie(runtime, session, await ops.webSessions.version(session.userId));
}

/** An expiry in the past: what `POST /logout` and `GET /logout` send back. */
export function clearedWebSessionCookie(runtime: PortalRuntime): string {
  return serialiseCookie(runtime.cookies.session, "", {
    secure: runtime.secureCookies,
    maxAgeSeconds: 0,
  });
}

/** True when the cookie's version still matches the user's. One indexed read, no write. */
export async function versionIsLive(ops: PortalOps, session: WebSession): Promise<boolean> {
  return (await ops.webSessions.version(session.userId)) === session.ver;
}

/**
 * The same check with its own transaction, for the callers that do not already have one.
 *
 * A cookie for a tenant that has gone, or a store that throws, reads as not live: this is the
 * "prove you are still signed in" direction, so it fails closed onto the sign-in form.
 */
export async function webSessionIsLive(
  runtime: PortalRuntime,
  session: WebSession | null,
): Promise<boolean> {
  if (!session) {
    return false;
  }
  try {
    return await runtime.store.tx(session.tenantId, (ops) => versionIsLive(ops, session));
  } catch {
    return false;
  }
}

/**
 * End every portal browser session this user holds, and say so in the audit log.
 *
 * Called from `POST /auth/logout` with `all_devices: true` — the one caller whose stated meaning
 * is already "everywhere" — and never from the single-browser sign-out, which clears its own
 * cookie and leaves anyone else's alone.
 */
export async function revokeWebSessions(
  ops: PortalOps,
  input: {
    readonly tenantId: string;
    readonly orgId: string | null;
    readonly userId: string;
    readonly ip?: string | null;
  },
): Promise<number> {
  const version = await ops.webSessions.revoke({ userId: input.userId, tenantId: input.tenantId });
  await auditWebSessionRevoked(ops, { ...input, scope: "user", version });
  return version;
}

/**
 * One action name for "a portal browser session ended", with the blast radius in `after.scope`:
 * `browser` is this cookie only (`/logout`), `user` is every browser that person holds
 * (`/auth/logout` with `all_devices`).
 */
export async function auditWebSessionRevoked(
  ops: PortalOps,
  input: {
    readonly tenantId: string;
    readonly orgId: string | null;
    readonly userId: string;
    readonly scope: "browser" | "user";
    readonly version?: number;
    readonly ip?: string | null;
  },
): Promise<void> {
  await ops.audit.append({
    tenantId: input.tenantId,
    orgId: input.orgId,
    actorKind: "user",
    actorUserId: input.userId,
    action: "web_session.revoked",
    targetKind: "user",
    targetId: input.userId,
    after: { scope: input.scope, ...(input.version === undefined ? {} : { version: input.version }) },
    ip: input.ip ?? null,
  });
}
