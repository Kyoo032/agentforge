/**
 * The environment the browser sign-in reads, and the one refusal the three variables share
 * (Phase 9, docs/internal/web-phase9-portal-login.md §Env).
 *
 *   AGENTFORGE_PORTAL_URL            the portal (already read by ./portal-client.ts)
 *   AGENTFORGE_PORTAL_CLIENT_ID      this app's OAuth client at that portal
 *   AGENTFORGE_PORTAL_CLIENT_SECRET  its secret — a CONFIDENTIAL client: the exchange is made by
 *                                    the host process, never by the browser
 *   AGENTFORGE_PUBLIC_URL            the origin the browser reaches this deployment on; the
 *                                    `redirect_uri` is built from it. Defaults to the first entry
 *                                    of `trustedOrigins(env)`.
 *
 * **Missing configuration is a 503 with its own code, never a 500 and never a fall back.** An
 * exchange without client credentials would be an unauthenticated one, which the deployment
 * template promises never happens; a `redirect_uri` guessed from a request header would be a wide
 * open redirect. So each of these refuses with `login_not_configured` and names the variable, which
 * is something an operator can act on — and the sign-in screen renders either way, so a
 * misconfigured deployment says "sign-in is not configured" rather than showing a dead button.
 *
 * No value read here is ever logged, and the refusal never carries the secret.
 */
import { ApiError, isLoopbackHost, normaliseOrigin, trustedOrigins } from "@agentforge/core";
import type { EnvLike } from "@agentforge/core";
import { portalBaseUrl } from "./portal-client";

export const PORTAL_CLIENT_ID_ENV = "AGENTFORGE_PORTAL_CLIENT_ID";
export const PORTAL_CLIENT_SECRET_ENV = "AGENTFORGE_PORTAL_CLIENT_SECRET";
export const PUBLIC_URL_ENV = "AGENTFORGE_PUBLIC_URL";

/** The renderer route the portal redirects the browser back to (lane C owns the screen). */
export const AUTH_CALLBACK_PATH = "/auth/callback";

/** One code for every "this deployment cannot sign anybody in" answer. 503, because it is the server. */
export const LOGIN_CONFIG_ERROR = "login_not_configured";
const LOGIN_CONFIG_STATUS = 503;

export type PortalClientCredentials = {
  readonly clientId: string;
  readonly clientSecret: string;
};

export type PortalLoginConfig = PortalClientCredentials & {
  readonly portalBaseUrl: string;
  readonly redirectUri: string;
};

function configError(detail: string): ApiError {
  return new ApiError(
    LOGIN_CONFIG_ERROR,
    `Sign-in is not configured on this deployment: ${detail}`,
    LOGIN_CONFIG_STATUS,
  );
}

function trimmed(env: EnvLike, name: string): string {
  return env[name]?.trim() ?? "";
}

/**
 * An origin the browser can actually reach this deployment on: https anywhere, http on loopback
 * only. The same rule `assertAllowedEndpointUrl` applies outbound, stated here rather than borrowed
 * so the refusal carries this module's code and status instead of a 400 about an "endpoint".
 */
function publicOrigin(raw: string): string | null {
  const origin = normaliseOrigin(raw);
  if (!origin) {
    return null;
  }
  const url = new URL(origin);
  if (url.protocol === "https:") {
    return origin;
  }
  return url.protocol === "http:" && isLoopbackHost(url.hostname) ? origin : null;
}

/**
 * The public origin, as a bare `scheme://host[:port]`.
 *
 * An explicit `AGENTFORGE_PUBLIC_URL` wins and is refused rather than repaired when it is not a
 * reachable origin — a deployment that names itself wrongly must not quietly sign people in through
 * some other name. With nothing set, the first trusted origin is the answer, which is already
 * https-only in server mode (`trustedOrigins`).
 */
export function publicBaseUrl(env: EnvLike = process.env): string {
  const explicit = trimmed(env, PUBLIC_URL_ENV);
  if (explicit) {
    const origin = publicOrigin(explicit);
    if (origin) {
      return origin;
    }
    throw configError(`${PUBLIC_URL_ENV} must be an https origin, or http on loopback.`);
  }
  const first = trustedOrigins(env)[0];
  const fallback = first ? publicOrigin(first) : null;
  if (!fallback) {
    throw configError(`set ${PUBLIC_URL_ENV}, or an https entry in AGENTFORGE_TRUSTED_ORIGINS.`);
  }
  return fallback;
}

/**
 * Where the portal sends the authorization code back to. One function, so `/auth/start` and
 * `/auth/login` cannot disagree — the portal compares the two against each other.
 */
export function publicRedirectUri(env: EnvLike = process.env): string {
  return `${publicBaseUrl(env)}${AUTH_CALLBACK_PATH}`;
}

export function portalClientCredentials(env: EnvLike = process.env): PortalClientCredentials {
  const clientId = trimmed(env, PORTAL_CLIENT_ID_ENV);
  const clientSecret = trimmed(env, PORTAL_CLIENT_SECRET_ENV);
  if (!clientId) {
    throw configError(`${PORTAL_CLIENT_ID_ENV} is not set.`);
  }
  if (!clientSecret) {
    throw configError(`${PORTAL_CLIENT_SECRET_ENV} is not set.`);
  }
  return { clientId, clientSecret };
}

/**
 * The same two values for a refresh, or null where they are not both configured.
 *
 * The code exchange cannot go ahead without a client and refuses (`portalClientCredentials`). A
 * refresh can: the portal counts it against the caller's address instead of the client
 * (`./portal-check.ts`). And a desk or webdev, which has no portal client at all, must not throw on
 * every portal check. The hosted boot check (`../hosted-env.ts`) already refuses to start without
 * both, so on a server this is never null.
 */
export function configuredClientCredentials(env: EnvLike = process.env): PortalClientCredentials | null {
  const clientId = trimmed(env, PORTAL_CLIENT_ID_ENV);
  const clientSecret = trimmed(env, PORTAL_CLIENT_SECRET_ENV);
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/**
 * Everything `/auth/start` needs. `portalBaseUrl` throws a plain `Error` when the variable is
 * absent — correct for the client, which must never be constructed off a server — so it is caught
 * here and reported as the same configuration refusal rather than reaching a browser as a 500.
 */
export function portalLoginConfig(env: EnvLike = process.env): PortalLoginConfig {
  let base: string;
  try {
    base = portalBaseUrl(env);
  } catch {
    throw configError("AGENTFORGE_PORTAL_URL is not set, or is not a usable https URL.");
  }
  return { portalBaseUrl: base, redirectUri: publicRedirectUri(env), ...portalClientCredentials(env) };
}
