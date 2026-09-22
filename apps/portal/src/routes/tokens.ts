/**
 * The JSON endpoints the app and the host call: `/auth/token`, `/auth/device/code`,
 * `/auth/device/token`, `/auth/logout`, `/auth/session`, `/tenant/config`,
 * `/.well-known/jwks.json`.
 *
 * Every refusal on `/auth/token` and `/auth/logout` goes through `tokenError`, which narrows the
 * reason to the vocabulary `packages/host/src/auth/session.ts` understands. Everything else uses
 * the full portal vocabulary, because the app -- not the host -- is the reader.
 */
import { publishedJwks } from "../jwt/keys";
import type { PortalRuntime } from "../flows/context";
import { pollDeviceToken, requestDeviceCode } from "../flows/device";
import { statusFor } from "../flows/reasons";
import {
  authenticate,
  describeSession,
  readBearer,
  readTenantConfig,
  revokeSession,
} from "../flows/session";
import { exchangeAuthorizationCode, exchangeRefreshToken } from "../flows/token";
import { boundedField, stringField } from "../security/body";
import type { PortalRequest, PortalResponse, PortalRoute } from "../server";
import { jsonError, jsonResponse, limit, readJson, requestContext, tokenError } from "./support";

const MAX_TOKEN_FIELD = 1024;
const MAX_SLUG = 64;

export function tokenRoutes(runtime: PortalRuntime): readonly PortalRoute[] {
  return [
    { method: "POST", path: "/auth/token", handle: (request) => postToken(runtime, request) },
    { method: "POST", path: "/auth/device/code", handle: (request) => postDeviceCode(runtime, request) },
    { method: "POST", path: "/auth/device/token", handle: (request) => postDeviceToken(runtime, request) },
    { method: "POST", path: "/auth/logout", handle: (request) => postLogout(runtime, request) },
    { method: "GET", path: "/auth/session", handle: (request) => getSession(runtime, request) },
    { method: "GET", path: "/tenant/config", handle: (request) => getTenantConfig(runtime, request) },
    { method: "GET", path: "/.well-known/jwks.json", handle: () => getJwks(runtime) },
  ];
}

async function postToken(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readJson(request);
  if (!body.ok) {
    return tokenError("invalid_request");
  }
  const refusal = limit([runtime.limiters.tokenIp, context.ipKey]);
  if (!refusal.ok) {
    return tokenError("rate_limited", refusal.retryAfter);
  }

  const grantType = stringField(body.fields, "grant_type");

  if (grantType === "authorization_code") {
    const code = boundedField(body.fields, "code", MAX_TOKEN_FIELD);
    const redirectUri = boundedField(body.fields, "redirect_uri", MAX_TOKEN_FIELD);
    const clientId = boundedField(body.fields, "client_id", MAX_TOKEN_FIELD);
    const clientSecret = boundedField(body.fields, "client_secret", MAX_TOKEN_FIELD);
    if (!code || !redirectUri || !clientId || !clientSecret) {
      return tokenError("invalid_request");
    }
    const result = await exchangeAuthorizationCode(runtime, {
      code,
      redirectUri,
      clientId,
      clientSecret,
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return result.ok ? jsonResponse(200, result.body) : tokenError(result.reason);
  }

  if (grantType === "refresh_token") {
    const refreshToken = boundedField(body.fields, "refresh_token", MAX_TOKEN_FIELD);
    if (!refreshToken) {
      return tokenError("invalid_request");
    }
    const result = await exchangeRefreshToken(runtime, {
      refreshToken,
      deviceId: boundedField(body.fields, "device_id", MAX_TOKEN_FIELD),
      ip: context.ip,
      userAgent: context.userAgent,
    });
    return result.ok ? jsonResponse(200, result.body) : tokenError(result.reason);
  }

  return tokenError("invalid_request");
}

async function postDeviceCode(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readJson(request);
  if (!body.ok) {
    return jsonError("invalid_request");
  }
  const installId = boundedField(body.fields, "install_id", 128);

  // Both buckets from the doc: 5 / 10 min per install_id, 30 / 10 min per IP.
  const refusal = limit(
    [runtime.limiters.deviceCodeInstall, installId ?? context.ipKey],
    [runtime.limiters.deviceCodeIp, context.ipKey],
  );
  if (!refusal.ok) {
    return jsonError("rate_limited", refusal.retryAfter);
  }

  const result = await requestDeviceCode(runtime, {
    installId,
    tenantHint: boundedField(body.fields, "tenant_hint", MAX_SLUG),
    platform: boundedField(body.fields, "platform", 32),
    appVersion: boundedField(body.fields, "app_version", 32),
    label: boundedField(body.fields, "label", 64),
    ip: context.ip,
  });
  return result.ok ? jsonResponse(200, result.body) : jsonError(result.reason);
}

async function postDeviceToken(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const body = readJson(request);
  if (!body.ok) {
    return jsonError("invalid_request");
  }
  const deviceCode = boundedField(body.fields, "device_code", MAX_TOKEN_FIELD);
  const installId = boundedField(body.fields, "install_id", 128);
  if (!deviceCode || !installId) {
    return jsonError("invalid_request");
  }

  const result = await pollDeviceToken(runtime, {
    deviceCode,
    installId,
    ip: context.ip,
    userAgent: context.userAgent,
  });
  if (result.ok) {
    return jsonResponse(200, result.body);
  }
  const retryAfter = "retryAfter" in result ? result.retryAfter : undefined;
  return jsonError(result.reason, retryAfter);
}

async function postLogout(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const authenticated = authenticate(runtime, readBearer(request.headers));
  if (!authenticated.ok) {
    return tokenError(authenticated.reason);
  }
  const body = readJson(request);
  const allDevices = body.ok && body.fields.all_devices === true;
  await revokeSession(runtime, authenticated.claims, allDevices);
  // "Idempotent, always 204" -- the doc is explicit, and a body would be a place to leak state.
  return { status: 204, body: "" };
}

async function getSession(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const authenticated = authenticate(runtime, readBearer(request.headers));
  if (!authenticated.ok) {
    return jsonResponse(401, { error: "invalid_grant", reason: authenticated.reason });
  }
  const summary = await describeSession(runtime, authenticated.claims);
  return summary.ok
    ? jsonResponse(200, summary.body)
    : jsonResponse(401, { error: "invalid_grant", reason: summary.reason });
}

/**
 * Branding for a browser that has not signed in yet, and the whole document for a Bearer.
 *
 * Two things here are controls rather than plumbing (SR-42):
 *
 *   - **The limiter runs first, on both branches.** The `?tenant=<slug>` branch is unauthenticated
 *     and costs three database round trips, and it had no limiter at all.
 *   - **An unknown slug and a suspended tenant are the same refusal.** They used to be `400
 *     invalid_request` and `403 tenant_inactive`, which turned this route into a tenant-name
 *     oracle anybody could walk a wordlist against. A Bearer still gets the real reason: that
 *     caller already belongs to the tenant, and "your provider's account is suspended" is the one
 *     sentence that lets them act.
 */
async function getTenantConfig(runtime: PortalRuntime, request: PortalRequest): Promise<PortalResponse> {
  const context = requestContext(runtime, request);
  const refusal = limit([runtime.limiters.tenantConfigIp, context.ipKey]);
  if (!refusal.ok) {
    return jsonError("rate_limited", refusal.retryAfter);
  }

  const slug = request.query.get("tenant");
  let tenantId: string | null = null;
  let authenticated = false;

  const bearer = readBearer(request.headers);
  if (bearer) {
    const verified = authenticate(runtime, bearer);
    if (!verified.ok) {
      return jsonResponse(401, { error: "invalid_grant", reason: verified.reason });
    }
    tenantId = verified.claims.tid;
    authenticated = true;
  } else if (slug && slug.length <= MAX_SLUG) {
    tenantId = await runtime.store.resolve.bySlug(slug);
  }

  if (!tenantId) {
    return jsonError("invalid_request");
  }
  const result = await readTenantConfig(runtime, { tenantId, authenticated });
  if (!result.ok) {
    return authenticated
      ? jsonResponse(statusFor(result.reason), { error: "invalid_grant", reason: result.reason })
      : jsonError("invalid_request");
  }

  const ifNoneMatch = request.headers["if-none-match"];
  const presented = Array.isArray(ifNoneMatch) ? ifNoneMatch[0] : ifNoneMatch;
  if (presented?.split(",").some((value) => value.trim() === result.etag)) {
    return { status: 304, headers: { etag: result.etag }, body: "" };
  }
  return jsonResponse(200, result.body, { etag: result.etag });
}

function getJwks(runtime: PortalRuntime): PortalResponse {
  // Public keys only, and cacheable: the gateway refreshes hourly and on an unknown `kid`.
  return jsonResponse(200, publishedJwks(runtime.keys), {
    "cache-control": "public, max-age=3600",
  });
}
