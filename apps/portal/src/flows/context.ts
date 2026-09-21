/**
 * Everything a flow needs, assembled once at boot.
 *
 * `src/server.ts` hands a route `{ config, store, clock, log }`; this adds the five things the
 * login needs on top of that -- the mailer, the signing keyring, the derived web-session secret,
 * the rate limiters, and the two values that are decisions rather than configuration (the token
 * `iss` and whether `X-Forwarded-For` may be believed).
 *
 * It is built in one place so a route handler never reaches for `process.env` and never
 * constructs a limiter of its own: a limiter built per request would count to one for ever.
 */
import type { PortalConfig } from "../config";
import type { Keyring } from "../jwt/keys";
import type { Logger } from "../log";
import type { Mailer } from "../mail/types";
import { cookieNames, cookiesAreSecure, type CookieNames } from "../security/cookies";
import { createPortalLimiters, type PortalLimiters } from "../security/rate-limit";
import { webSessionSecret, type WebSessionSecret } from "../security/web-session";
import type { Clock, PortalStore } from "../store/types";

export interface PortalRuntime {
  readonly config: PortalConfig;
  readonly store: PortalStore;
  readonly clock: Clock;
  readonly log: Logger;
  readonly mailer: Mailer;
  readonly keys: Keyring;
  readonly webSecret: WebSessionSecret;
  readonly cookies: CookieNames;
  readonly secureCookies: boolean;
  readonly limiters: PortalLimiters;
  /** The access token's `iss`, and the origin every absolute link in a page is built from. */
  readonly issuer: string;
  readonly trustProxy: boolean;
}

export interface CreateRuntimeOptions {
  readonly config: PortalConfig;
  readonly store: PortalStore;
  readonly log: Logger;
  readonly mailer: Mailer;
  readonly keys: Keyring;
  readonly clock?: Clock;
  /** Test seam only: the suites listen on an ephemeral port and know their origin after `listen`. */
  readonly issuer?: string;
  readonly trustProxy?: boolean;
}

/**
 * `config.publicUrl` when the deployment set one, otherwise the address the process is bound to.
 *
 * The fallback is right for the loopback review instance (`http://127.0.0.1:4000`) and wrong for
 * anything behind a proxy, which is why `PORTAL_PUBLIC_URL` exists and why `loadConfig` requires it
 * in production: `iss` is what the gateway compares against, and a token minted with the wrong
 * issuer fails verification everywhere.
 *
 * It is read from the validated config rather than from `process.env` (SR-33). A route handler
 * never reaches for the environment, and neither does this.
 */
export function defaultIssuer(config: PortalConfig): string {
  if (config.publicUrl) {
    return config.publicUrl;
  }
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;
  return `http://${host.includes(":") ? `[${host}]` : host}:${config.port}`;
}

export function createRuntime(options: CreateRuntimeOptions): PortalRuntime {
  const clock = options.clock ?? options.store.clock;
  // Resolved before the cookie rule, because the cookie rule reads it: the public URL is what a
  // browser reaches this portal on, and behind a proxy that is the only thing that says whether
  // the session cookie is travelling over TLS. See `security/cookies.ts`.
  const issuer = options.issuer ?? defaultIssuer(options.config);
  const mode = { production: options.config.production, host: options.config.host, publicUrl: issuer };

  return Object.freeze({
    config: options.config,
    store: options.store,
    clock,
    log: options.log,
    mailer: options.mailer,
    keys: options.keys,
    webSecret: webSessionSecret(options.keys.current),
    cookies: cookieNames(mode),
    secureCookies: cookiesAreSecure(mode),
    limiters: createPortalLimiters(clock),
    issuer,
    trustProxy: options.trustProxy ?? options.config.trustProxy,
  });
}
