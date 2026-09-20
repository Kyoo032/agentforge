/**
 * The four session routes of the hosted deployment (docs/internal/web-migration-plan.md Phase 2):
 *
 *   POST /api/v1/auth/login    { code }            → sets the session cookie
 *   POST /api/v1/auth/logout                       → revokes it, portal-side and here
 *   GET  /api/v1/auth/session                      → { signedIn, … } | { signedIn: false, reason? }
 *   POST /api/v1/auth/refresh                      → rotates the portal tokens, extends the session
 *
 * Every failure goes out through the existing `{ error: { code, message } }` envelope with a reason
 * code from the portal's own list (docs/internal/portal/device-code-login.md:222); the message is
 * the portal's `message_en` when it sent one, otherwise the same English copy the doc's table gives
 * (:409-423). The renderer localises by code — apps/web/locales/{en,id}/auth.json.
 *
 * `POST /login` takes `{ code }` because the doc leaves the browser half open (see ./portal-client).
 *
 * Reading the cookie: this module reads `request.headers.cookie`, which the HTTP adapter forwards
 * raw (`http-adapter.ts:263`) alongside the cookies it parses for itself.
 */
import { ApiError, isServerMode } from "@agentforge/core";
import type { PortalIdentity } from "@agentforge/db";
import { jsonError, jsonOk } from "../errors";
import type { HostJsonResult, HostRequest } from "../types";
import { PortalError, type PortalTokens } from "./portal-client";
import type { PortalClient } from "./portal-client";
import type { SessionStore, TokenVault } from "./session-store";
import {
  sessionCookieMaxAge,
  sessionCookieName,
  type AuthReason,
  type SessionRecord,
  createSession,
  readSessionCookie,
  revokedSession,
  sessionSummary,
  slidSession,
  verifySession,
} from "./session";

export const AUTH_ROUTE_PREFIX = "/api/v1/auth/";
/**
 * The two reads that have to answer before anyone can sign in: the health probe the proxy polls,
 * and the component status the first-run installer shows (router.ts:186, handlers/components.ts:1-9).
 * Neither returns a byte of tenant data. Nothing else under `/api` is exempt, for any method.
 */
export const UNGATED_GETS: ReadonlySet<string> = new Set(["/api/v1/ping", "/api/v1/components"]);

/**
 * Phase 5 lane B: the one POST under `/api` that runs without a session.
 *
 * `isSessionExemptPath` is GET-only outside the auth prefix, by design and with a comment saying
 * so, so this is a deliberate widening and it is kept to a single literal path rather than a
 * prefix: no browser calls the billing webhook, the caller is a payment provider's server, and it
 * authenticates on a shared secret compared in constant time (`../billing/authenticate.ts`).
 * Nothing else may join this set without the same two properties.
 */
export const UNGATED_POSTS: ReadonlySet<string> = new Set(["/api/v1/billing/webhook"]);

export type AuthRouteDeps = {
  readonly store: SessionStore;
  readonly vault: TokenVault;
  readonly portal: PortalClient;
  /** Hosted deployment? Decides the cookie's `Secure` flag; injected so tests never touch env. */
  readonly serverMode: boolean;
  /**
   * Writes the host's rows for a portal identity on first sign-in (lane C). Injected so a test can
   * exercise the sign-in without a database, the same way `store` and `portal` already are.
   */
  readonly provision: (identity: PortalIdentity) => Promise<unknown>;
  /**
   * Phase 5 lane B: take a seat for this person, or refuse the sign-in.
   *
   * Sign-in is where a seat cap belongs. The portal already refuses here and already has the
   * reason code (`seat_cap_reached`, which this module has carried English and Indonesian copy for
   * since Phase 2); the gateway gate is the wrong place to discover you have no seat, because by
   * then you are signed in and working (decision doc D5).
   *
   * Injected like `provision`, so a test drives the refusal without a database, and so the
   * desktop — which never signs in — never reaches the store at all. The default supplied by
   * `../auth/index.ts` admits everybody when no cap is configured.
   */
  readonly claimSeat: (identity: PortalIdentity) => Promise<{ readonly ok: boolean }>;
  readonly now?: () => number;
};

/** The doc's own English copy per reason, used when the portal sends none (:409-423). */
const REASON_COPY_EN: Record<AuthReason, string> = {
  tenant_inactive: "Your provider's account is not active. Contact support.",
  org_inactive: "Your organisation is not active.",
  org_past_due: "Your organisation's payment is overdue.",
  user_inactive: "Your account is disabled.",
  seat_cap_reached: "No seats left in your organisation.",
  device_revoked: "This device was signed out by an admin.",
  session_revoked: "You were signed out. Please sign in again.",
  refresh_reused: "Signed out for security. Please sign in again.",
  refresh_expired: "Your session expired. Please sign in again.",
  invalid_request: "The sign-in request was not valid.",
  invalid_grant: "That sign-in link is no longer valid. Start again.",
  session_required: "Please sign in to continue.",
  portal_unavailable: "Cannot reach the sign-in service. Try again.",
};

export function reasonMessage(reason: AuthReason): string {
  return REASON_COPY_EN[reason];
}

/** Reason → the host's `ApiError`, so the envelope and the reason vocabulary stay the same one. */
export function authError(reason: AuthReason, status: number, message?: string | null): ApiError {
  return new ApiError(reason, message || reasonMessage(reason), status);
}

function fromPortal(error: unknown): ApiError {
  if (error instanceof PortalError) {
    return authError(error.reason, error.status, error.messageEn);
  }
  // Matched by name, not `instanceof`: importing the class as a value would pull `@agentforge/db`'s
  // barrel in statically and open SQLite when this module is imported, which the module comment at
  // ./index.ts forbids and `createHostSessionStore` goes out of its way to avoid.
  if (error instanceof Error && error.name === "PortalProvisionError") {
    // The host already holds this org under a different tenant. Never re-home the rows: refuse the
    // sign-in and let an operator look, because one of the two tenants owns that data.
    return authError("org_inactive", 403);
  }
  throw error;
}

/**
 * Calls that run without a session; everything else under `/api` needs one, whatever the method.
 *
 * The method is part of the answer: `GET /api/v1/components` reports what is installed, while
 * `POST /api/v1/components/install/stream` spends the machine's disk and bandwidth.
 */
export function isSessionExemptPath(method: string, path: string): boolean {
  if (path.startsWith(AUTH_ROUTE_PREFIX)) {
    return true;
  }
  const verb = method.toUpperCase();
  if (verb === "POST") {
    return UNGATED_POSTS.has(path);
  }
  return verb === "GET" && UNGATED_GETS.has(path);
}

/**
 * Which cookie name this process reads.
 *
 * `serverMode` is injected everywhere it is known (`createAuthRoutes` has it) and falls back to the
 * environment for the one caller that does not pass it: the router's session gate
 * (`../router.ts`), which resolves the same flag per request one frame up.
 */
type CookieDeps = Pick<AuthRouteDeps, "store" | "now"> & Partial<Pick<AuthRouteDeps, "serverMode">>;

function cookieMode(deps: { readonly serverMode?: boolean }): { readonly secure: boolean } {
  return { secure: deps.serverMode ?? isServerMode() };
}

function sessionIdOf(request: HostRequest, deps: CookieDeps): string | null {
  return readSessionCookie(request.headers.cookie ?? null, cookieMode(deps));
}

/** Verify the cookie against the store, sliding `lastSeenAt` when the 5 minute window has passed. */
export async function loadSession(
  request: HostRequest,
  deps: CookieDeps,
): Promise<{ id: string | null; verdict: ReturnType<typeof verifySession> }> {
  const id = sessionIdOf(request, deps);
  if (!id) {
    return { id: null, verdict: { ok: false, reason: "session_required" } };
  }
  const now = (deps.now ?? Date.now)();
  const verdict = verifySession(await deps.store.find(id), now);
  if (verdict.ok && verdict.slid) {
    await deps.store.save(verdict.session);
  }
  return { id, verdict };
}

/** The gate: a verified session, or an `ApiError` the router turns into the 401/403 envelope. */
export async function requireSessionFor(request: HostRequest, deps: CookieDeps): Promise<SessionRecord> {
  const { verdict } = await loadSession(request, deps);
  if (!verdict.ok) {
    throw authError(verdict.reason, 401);
  }
  return verdict.session;
}

/**
 * `HttpOnly; SameSite=Lax; Path=/; Max-Age=<lifetime>` plus `Secure` and the `__Host-` name on the
 * hosted server (A2 / T1, and the hosted XSS audit). The adapter serialises these attributes
 * (`http-adapter.ts:138-146`) and writes no `Domain`, which `__Host-` also requires; this module
 * never builds a `Set-Cookie` string of its own.
 */
function cookieFor(deps: Pick<AuthRouteDeps, "serverMode" | "now">, session: SessionRecord): HostJsonResult["cookies"] {
  const now = (deps.now ?? Date.now)();
  return [
    {
      name: sessionCookieName(cookieMode(deps)),
      value: session.id,
      path: "/",
      sameSite: "Lax",
      httpOnly: true,
      secure: deps.serverMode,
      maxAge: sessionCookieMaxAge(session, now),
    },
  ];
}

function clearedCookie(deps: Pick<AuthRouteDeps, "serverMode">): HostJsonResult["cookies"] {
  return [
    {
      name: sessionCookieName(cookieMode(deps)),
      value: "",
      path: "/",
      sameSite: "Lax",
      httpOnly: true,
      secure: deps.serverMode,
      maxAge: 0,
    },
  ];
}

function readCode(body: unknown): string {
  const code = (body as { code?: unknown } | undefined)?.code;
  if (typeof code !== "string" || code.trim().length === 0) {
    throw authError("invalid_request", 400, "A sign-in code is required.");
  }
  return code.trim();
}

/** Handlers catch and return the envelope, exactly like every other handler in `handlers/`. */
function guarded(
  fn: (request: HostRequest) => Promise<HostJsonResult>,
): (request: HostRequest) => Promise<HostJsonResult> {
  return async (request) => {
    try {
      return await fn(request);
    } catch (error) {
      return jsonError(error) as HostJsonResult;
    }
  };
}

function withCookies(result: HostJsonResult, cookies: HostJsonResult["cookies"]): HostJsonResult {
  return { ...result, cookies };
}

export type AuthRoutes = {
  handleLogin: (request: HostRequest) => Promise<HostJsonResult>;
  handleLogout: (request: HostRequest) => Promise<HostJsonResult>;
  handleSession: (request: HostRequest) => Promise<HostJsonResult>;
  handleRefresh: (request: HostRequest) => Promise<HostJsonResult>;
};

export function createAuthRoutes(deps: AuthRouteDeps): AuthRoutes {
  const clock = () => (deps.now ?? Date.now)();

  async function endSession(session: SessionRecord, at: number): Promise<void> {
    await deps.store.save(revokedSession(session, at));
    await deps.vault.delete(session.id);
  }

  const handleLogin = guarded(async (request: HostRequest) => {
    const code = readCode(request.body);
    let tokens: PortalTokens;
    try {
      tokens = await deps.portal.exchangeCode({ code });
    } catch (error) {
      throw fromPortal(error);
    }
    const now = clock();
    // Phase 3 lane C: first sign-in is what provisions the tenant. The portal has just vouched for
    // these three ids, so this is the one moment the host may write rows for them; every later
    // request only ever READS them (`resolvePortalTenant`), which is what makes a session the host
    // has never provisioned a refusal rather than a new desk. Off server mode nothing signs in, so
    // the desktop never reaches this line.
    const identity: PortalIdentity = {
      tenantId: tokens.tenantId,
      orgId: tokens.orgId,
      userId: tokens.userId,
    };
    try {
      await deps.provision(identity);
    } catch (error) {
      throw fromPortal(error);
    }
    // Phase 5 lane B, and in this order deliberately: provisioning writes the tenant row the seat
    // has a foreign key to, so the seat cannot be claimed before the tenant exists. A refusal here
    // leaves the rows provisioning wrote — they are the portal's facts about who this person is,
    // and they are what an admin raising the cap or revoking a seat acts on. No session is created
    // and no cookie is set, so the browser is exactly as signed out as it was.
    const seat = await deps.claimSeat(identity);
    if (!seat.ok) {
      throw authError("seat_cap_reached", 403);
    }
    const session = createSession({
      tenantId: tokens.tenantId,
      userId: tokens.userId,
      orgId: tokens.orgId,
      now,
    });
    await deps.store.create(session);
    await deps.vault.put(session.id, {
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      deviceId: tokens.deviceId,
    });
    return jsonOk(sessionSummary(session), 200, cookieFor(deps, session));
  });

  const handleLogout = guarded(async (request: HostRequest) => {
    const id = sessionIdOf(request, deps);
    const session = id ? await deps.store.find(id) : null;
    if (!session) {
      // Idempotent: a stale or absent cookie still leaves the browser signed out.
      return jsonOk({ signedIn: false }, 200, clearedCookie(deps));
    }
    const tokens = await deps.vault.get(session.id);
    if (tokens) {
      // Contractually idempotent portal-side (doc :230); a refusal must not block the local wipe.
      await deps.portal.logout({ accessToken: tokens.accessToken }).catch(() => undefined);
    }
    await endSession(session, clock());
    return jsonOk({ signedIn: false }, 200, clearedCookie(deps));
  });

  const handleSession = guarded(async (request: HostRequest) => {
    const { id, verdict } = await loadSession(request, deps);
    if (verdict.ok) {
      return jsonOk(sessionSummary(verdict.session));
    }
    // A visitor who never signed in is not an error and gets no reason to render.
    return jsonOk(id === null ? { signedIn: false } : { signedIn: false, reason: verdict.reason });
  });

  const handleRefresh = guarded(async (request: HostRequest) => {
    const session = await requireSessionFor(request, deps);
    const now = clock();
    const tokens = await deps.vault.get(session.id);
    if (!tokens) {
      // Nothing to present to the portal — the host restarted since this browser signed in.
      await endSession(session, now);
      throw authError("refresh_expired", 401);
    }
    let rotated: PortalTokens;
    try {
      rotated = await deps.portal.refresh({ refreshToken: tokens.refreshToken, deviceId: tokens.deviceId });
    } catch (error) {
      const api = fromPortal(error);
      if (api.code === "portal_unavailable") {
        // Offline, not refused: the session survives (doc §Offline, the 7-day grace).
        throw api;
      }
      // Every other reason is terminal: the portal says this session is over, so it is.
      await endSession(session, now);
      return withCookies(jsonError(api) as HostJsonResult, clearedCookie(deps));
    }
    await deps.vault.put(session.id, {
      refreshToken: rotated.refreshToken,
      accessToken: rotated.accessToken,
      deviceId: rotated.deviceId,
    });
    const extended = slidSession(session, now);
    await deps.store.save(extended);
    return jsonOk(sessionSummary(extended), 200, cookieFor(deps, extended));
  });

  return { handleLogin, handleLogout, handleSession, handleRefresh };
}
