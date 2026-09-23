/**
 * The auth module's public surface, and the one place the hosted server's real dependencies are
 * wired together (store → SQLite, the refresh token → sealed on the session row under the wrap key,
 * vault → process memory, portal → `AGENTFORGE_PORTAL_URL`).
 *
 * Everything is lazy on purpose. The desktop and webdev import the router and never sign in, so
 * nothing here may open the database or read the portal URL at import time — `portalBaseUrl` throws
 * when the variable is absent, which is correct on a server and wrong everywhere else.
 */
import { isServerMode } from "@agentforge/core";
import { getLocalVaultKey } from "@agentforge/db/vault-key";
import { log } from "../log";
import { createPortalSessionCheck, type PortalSessionCheck } from "./portal-check";
import { createPortalClient, type PortalClient, type PortalClientOptions } from "./portal-client";
import { configuredClientCredentials } from "./portal-config";
import { createSessionSecrets, type SessionSecrets } from "./session-secrets";
import { createHostSessionStore, createMemoryTokenVault, type SessionStore, type TokenVault } from "./session-store";
import { createAuthRoutes, type AuthRoutes } from "./routes";

export {
  ABSOLUTE_LIFETIME_MS,
  AUTH_REASONS,
  IDLE_TIMEOUT_MS,
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  SESSION_ID_BYTES,
  PORTAL_CHECK_INTERVAL_MS,
  SLIDE_INTERVAL_MS,
  createSession,
  hashSessionId,
  isAuthReason,
  mintSessionId,
  portalCheckDue,
  readSessionCookie,
  revokedSession,
  sessionCookieMaxAge,
  sessionCookieName,
  sessionSummary,
  slidSession,
  verifySession,
} from "./session";
export type { AuthReason, SessionCookieMode, SessionRecord, SessionSummary, SessionVerdict } from "./session";
export {
  createDrizzleSessionStore,
  createHostSessionStore,
  createMemorySessionStore,
  createMemoryTokenVault,
} from "./session-store";
export type { PortalTokenSet, SessionStore, TokenVault } from "./session-store";
export {
  REFRESH_SEALING_INFO,
  createSessionSecrets,
  openRefresh,
  refreshSealingKey,
  sealRefresh,
} from "./session-secrets";
export type { SessionSecrets, StoredRefresh } from "./session-secrets";
export {
  PORTAL_CHECK_RETRY_MS,
  PORTAL_CHECK_WAIT_MS,
  TERMINAL_PORTAL_REASONS,
  createPortalSessionCheck,
  isTerminalPortalReason,
} from "./portal-check";
export type {
  PortalCheckContext,
  PortalGateVerdict,
  PortalRefreshOutcome,
  PortalSessionCheck,
  PortalSessionCheckOptions,
} from "./portal-check";
export {
  PORTAL_AUTHORIZE_PATH,
  PORTAL_TIMEOUT_MS,
  PORTAL_URL_ENV,
  PortalError,
  buildAuthorizeUrl,
  createFakePortalClient,
  createPortalClient,
  mapPortalError,
  portalBaseUrl,
} from "./portal-client";
export type {
  FakePortalClient,
  PortalClient,
  PortalClientOptions,
  PortalExchangeInput,
  PortalRefreshInput,
  PortalTokens,
} from "./portal-client";
export {
  LOGIN_STATE_BYTES,
  LOGIN_STATE_COOKIE,
  LOGIN_STATE_COOKIE_SECURE,
  LOGIN_STATE_MAX_AGE_SECONDS,
  loginStateCookieName,
  mintLoginState,
  readLoginStateCookie,
  statesMatch,
} from "./login-state";
export {
  AUTH_CALLBACK_PATH,
  LOGIN_CONFIG_ERROR,
  PORTAL_CLIENT_ID_ENV,
  PORTAL_CLIENT_SECRET_ENV,
  PUBLIC_URL_ENV,
  configuredClientCredentials,
  portalClientCredentials,
  portalLoginConfig,
  publicBaseUrl,
  publicRedirectUri,
} from "./portal-config";
export type { PortalClientCredentials, PortalLoginConfig } from "./portal-config";
export {
  AUTH_ROUTE_PREFIX,
  UNGATED_GETS,
  authError,
  createAuthRoutes,
  isSessionExemptPath,
  loadSession,
  reasonMessage,
  requireSessionFor,
} from "./routes";
export type { AuthRouteDeps, AuthRoutes } from "./routes";

/** A client that resolves its base URL on the first call, not at construction. */
export function createLazyPortalClient(options: PortalClientOptions = {}): PortalClient {
  let inner: PortalClient | null = null;
  const resolve = (): PortalClient => {
    inner ??= createPortalClient(options);
    return inner;
  };
  return {
    exchangeCode: (input) => resolve().exchangeCode(input),
    refresh: (input) => resolve().refresh(input),
    logout: (input) => resolve().logout(input),
  };
}

/** How often expired rows are swept out of `auth_sessions`. */
export const SESSION_PURGE_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Nothing else ever deletes a session row: sign-out revokes, a slide rewrites, and an expiry is only
 * ever read. Without this sweep the table grows for the life of the deployment and holds identities
 * that stopped being usable 30 days ago (web-security-spec row T1).
 *
 * Once at first use, then every `intervalMs`. The interval is `unref()`'d so a short-lived process
 * that happens to touch the store still exits, and a failed sweep is logged and retried at the next
 * tick rather than taking the process down.
 */
export function startSessionPurge(
  store: SessionStore,
  options: { readonly intervalMs?: number; readonly now?: () => number } = {},
): () => void {
  const clock = options.now ?? Date.now;
  const sweep = (): void => {
    void store.purgeExpired(clock()).catch((error: unknown) => {
      log.warn("session_purge_failed", { detail: error instanceof Error ? error.message : error });
    });
  };
  sweep();
  const timer = setInterval(sweep, options.intervalMs ?? SESSION_PURGE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}

let store: SessionStore | null = null;
let vault: TokenVault | null = null;
let portal: PortalClient | null = null;
let portalCheck: PortalSessionCheck | null = null;
let secrets: SessionSecrets | null = null;
let routes: AuthRoutes | null = null;
let stopPurge: (() => void) | null = null;

/** The server's session store: one per process, SQLite-backed, swept on a timer. */
export function hostSessionStore(): SessionStore {
  if (!store) {
    store = createHostSessionStore();
    stopPurge = startSessionPurge(store);
  }
  return store;
}

/**
 * This process's working copy of the portal tokens. The access token lives only here; the refresh
 * token is also sealed on the session row (`hostSessionSecrets`), which is what a restart reads.
 */
export function hostTokenVault(): TokenVault {
  vault ??= createMemoryTokenVault();
  return vault;
}

/**
 * Seals and opens the refresh token kept on each session row (`./session-secrets.ts`), under
 * `AGENTFORGE_SECRETS_KEY` as it stands at each call. One per process, shared by the gate's check
 * and the auth routes, so sign-in seals with exactly what a restart will open with.
 */
export function hostSessionSecrets(): SessionSecrets {
  secrets ??= createSessionSecrets(() => getLocalVaultKey());
  return secrets;
}

/** One portal client per process, resolved on its first call (`AGENTFORGE_PORTAL_URL`). */
export function hostPortalClient(): PortalClient {
  portal ??= createLazyPortalClient();
  return portal;
}

/**
 * The one refresh-at-a-time-per-session path to the portal, shared by the router's gate and the
 * auth routes. Two instances would each think they were the only refresh in flight, and the portal
 * answers a token presented twice by ending the whole session (./portal-check.ts). Builds no
 * connection and reads no environment until a due session with tokens actually asks.
 */
export function hostPortalCheck(): PortalSessionCheck {
  portalCheck ??= createPortalSessionCheck({
    vault: hostTokenVault(),
    portal: hostPortalClient(),
    secrets: hostSessionSecrets(),
    // Read per refresh, like the portal URL: the same environment the code exchange reads.
    clientCredentials: () => configuredClientCredentials(),
  });
  return portalCheck;
}

export function hostAuthRoutes(): AuthRoutes {
  routes ??= createAuthRoutes({
    store: hostSessionStore(),
    vault: hostTokenVault(),
    portal: hostPortalClient(),
    portalCheck: hostPortalCheck(),
    secrets: hostSessionSecrets(),
    serverMode: isServerMode(),
    // Lane C: first sign-in writes the tenant, org, user, membership and home desk. The import is
    // dynamic for the same reason `createHostSessionStore` makes its one dynamic: the desktop and
    // webdev import this module and never sign in, so `@agentforge/db` — which opens SQLite at
    // import — must not be pulled in statically from here.
    provision: async (identity) => {
      const { db, ensurePortalOwner } = await import("@agentforge/db");
      return ensurePortalOwner(db, identity);
    },
    // Phase 5 lane B. Dynamic for the same reason `provision` is: `entitlement-db.ts` imports
    // `@agentforge/db`, which opens SQLite at import, and the desktop imports this module without
    // ever signing in. `currentPlanRecord` gives a tenant with no plan row a null cap, which
    // admits everybody — so a deployment the billing webhook has never spoken to signs people in
    // exactly as it did before this lane.
    claimSeat: async (identity) => {
      await import("../entitlement-db");
      const { claimSeat, currentPlanRecord } = await import("../entitlement-store");
      const plan = currentPlanRecord(identity.tenantId);
      return claimSeat({
        tenantId: identity.tenantId,
        userId: identity.userId,
        organizationId: identity.orgId,
        seatCap: plan.seatCap,
      });
    },
  });
  return routes;
}

/** Tests only: forget the process-wide wiring (and its timer) so the next call rebuilds it. */
export function resetHostAuthForTests(): void {
  stopPurge?.();
  stopPurge = null;
  store = null;
  vault = null;
  portal = null;
  portalCheck = null;
  secrets = null;
  routes = null;
}
