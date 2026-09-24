/**
 * The per-request plumbing every route shares: who is asking, in which language, with which
 * cookies -- and the four response shapes.
 *
 * Routes stay thin because everything that is a decision lives in `src/flows/**` and everything
 * that is a guard lives in `src/security/**`. What is left here is the translation between an
 * HTTP request and those two, done once instead of in fourteen handlers.
 */
import type { PortalRuntime } from "../flows/context";
import { errorBody, statusFor, tokenErrorBody, type PortalReason } from "../flows/reasons";
import type { VerifyLoginOtpOutcome } from "../otp/verify";
import { parseFormBody, parseJsonBody, type BodyResult } from "../security/body";
import { clientIp, rateLimitKey } from "../security/client-ip";
import { parseCookies, serialiseCookie } from "../security/cookies";
import { csrfMatches, mintCsrfToken } from "../security/csrf";
import { htmlResponse } from "../security/headers";
import type { RateLimiter } from "../security/rate-limit";
import { readWebSession, type WebSession, WEB_SESSION_TTL_MS } from "../security/web-session";
import type { PortalRequest, PortalResponse } from "../server";
import { negotiateLocale, translator, type PortalLocale, type Translate } from "../views/i18n";
import { errorPage } from "../views/pages";

export interface RequestContext {
  readonly locale: PortalLocale;
  readonly t: Translate;
  readonly ip: string | null;
  readonly ipKey: string;
  readonly userAgent: string | null;
  readonly cookies: Readonly<Record<string, string>>;
  /** The portal's own browser session, when the cookie carries a live one. */
  readonly webSession: WebSession | null;
}

export function requestContext(runtime: PortalRuntime, request: PortalRequest): RequestContext {
  const locale = negotiateLocale(request.query, request.headers["accept-language"]);
  const cookies = parseCookies(request.headers.cookie);
  const ip = clientIp({ headers: request.headers, socketIp: request.ip, trustProxy: runtime.trustProxy });
  const agent = request.headers["user-agent"];

  return Object.freeze({
    locale,
    t: translator(locale),
    ip,
    ipKey: rateLimitKey(ip),
    userAgent: (Array.isArray(agent) ? agent[0] : agent) ?? null,
    cookies,
    webSession: readWebSession(
      runtime.webSecret,
      cookies[runtime.cookies.session],
      runtime.clock.now().getTime(),
    ),
  });
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export function jsonResponse(
  status: number,
  json: unknown,
  headers: Readonly<Record<string, string>> = {},
): PortalResponse {
  return { status, json, headers };
}

/** The doc's error body, with `Retry-After` mirrored into a header where there is one. */
export function jsonError(reason: PortalReason, retryAfter?: number): PortalResponse {
  const body = errorBody(reason, retryAfter);
  return jsonResponse(
    statusFor(reason),
    body,
    retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
  );
}

/** The same, narrowed to the reason vocabulary `packages/host/src/auth/session.ts` understands. */
export function tokenError(reason: PortalReason, retryAfter?: number): PortalResponse {
  const body = tokenErrorBody(reason, retryAfter);
  return jsonResponse(
    statusFor(reason),
    body,
    retryAfter === undefined ? {} : { "retry-after": String(retryAfter) },
  );
}

/**
 * The sentence the code form shows after a refused verify, for `/authorize/verify` and
 * `/activate/verify` alike. They used to carry a copy each, and a reason added to one would have
 * been missing from the other. The switch is exhaustive over the outcome type, so a new reason is a
 * compile error here rather than a silent "wrong code" on the page.
 */
export function codeErrorMessage(
  context: RequestContext,
  refused: Extract<VerifyLoginOtpOutcome, { readonly ok: false }>,
): string {
  switch (refused.reason) {
    case "locked":
      // The address, not the code: a fresh code is refused too, so "start again" would be wrong.
      return context.t("code.locked");
    case "too_many_attempts":
      return context.t("code.exhausted");
    case "expired":
    case "no_code":
      return context.t("code.expired");
    case "invalid_code":
      return context.t("code.invalid", { attempts: refused.attemptsRemaining });
    default: {
      const unhandled: never = refused.reason;
      return unhandled;
    }
  }
}

export function htmlError(
  context: RequestContext,
  key: string,
  options: { readonly status?: number; readonly cookie?: string } = {},
): PortalResponse {
  return htmlResponse(
    errorPage({ locale: context.locale, t: context.t, message: context.t(key) }),
    { status: options.status ?? 400, cookie: options.cookie },
  );
}

// ---------------------------------------------------------------------------
// Bodies
// ---------------------------------------------------------------------------

export function readJson(request: PortalRequest): BodyResult {
  return parseJsonBody(request.body);
}

export function readForm(request: PortalRequest): BodyResult {
  return parseFormBody(request.body);
}

/** A `POST /auth/device/approve` may arrive from the portal's own form or from a JSON caller. */
export function wantsJson(request: PortalRequest): boolean {
  const type = request.headers["content-type"];
  const value = (Array.isArray(type) ? type[0] : type) ?? "";
  return value.includes("application/json");
}

// ---------------------------------------------------------------------------
// CSRF
// ---------------------------------------------------------------------------

export interface CsrfHandle {
  readonly token: string;
  /** Present only when a fresh token had to be minted; `Set-Cookie` for the response. */
  readonly cookie: string | undefined;
}

/**
 * Reuse the cookie's token when the browser already has one, mint one when it does not. Reusing it
 * is what lets the sign-in page, the code page and the approve page each render without the
 * response having to carry a second `Set-Cookie` alongside the session cookie.
 */
export function ensureCsrf(runtime: PortalRuntime, context: RequestContext): CsrfHandle {
  const existing = context.cookies[runtime.cookies.csrf];
  if (existing) {
    return { token: existing, cookie: undefined };
  }
  const token = mintCsrfToken();
  return {
    token,
    cookie: serialiseCookie(runtime.cookies.csrf, token, {
      secure: runtime.secureCookies,
      maxAgeSeconds: Math.floor(WEB_SESSION_TTL_MS / 1000),
    }),
  };
}

export function csrfOk(
  runtime: PortalRuntime,
  context: RequestContext,
  fields: Readonly<Record<string, unknown>>,
): boolean {
  return csrfMatches(context.cookies[runtime.cookies.csrf], fields.csrf_token);
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

export interface LimitCheck {
  readonly ok: boolean;
  readonly retryAfter: number;
}

/** Counts one hit against each limiter and reports the first refusal. */
export function limit(...checks: ReadonlyArray<readonly [RateLimiter, string]>): LimitCheck {
  let refusal: LimitCheck | null = null;
  for (const [limiter, key] of checks) {
    const verdict = limiter.check(key);
    if (!verdict.ok && refusal === null) {
      refusal = { ok: false, retryAfter: verdict.retryAfter };
    }
  }
  return refusal ?? { ok: true, retryAfter: 0 };
}
