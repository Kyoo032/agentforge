import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isServerMode, trustedOrigins, WORKSPACE_COOKIE } from "@agentforge/core";
import { BILLING_TOKEN_HEADER } from "./billing/authenticate";
import { contentDispositionAttachment } from "./content-disposition";
import {
  checkCsrfToken,
  CSRF_HEADER,
  csrfSetCookie,
  csrfTokenMatchesSession,
  mintCsrfTokenFor,
  readCsrfCookie,
  type CsrfMode,
} from "./csrf";
import { dispatch } from "./router";
import { LIVENESS_BODY, LIVENESS_PATH } from "./handlers/health";
import { readSelectedWorkspaceId } from "./workspace";
import { sessionCookieName } from "./auth/session";
import { log } from "./log";
import {
  filterHttpRequest,
  isAllowedMutatingApiRequest,
  isAllowedWebHostHeader,
  isAllowedWebOrigin,
  isLoopbackHostHeader,
} from "./local-request";
import { RATE_LIMITED_CODE, RATE_LIMITED_MESSAGE, checkRequestRate, clientIp, sessionRateKey } from "./rate-limit";
import { applySecurityHeaders } from "./security-headers";
import type { HostCookie, HostFile, HostRequest, HostResult } from "./types";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** Only paths under this prefix are answered here; everything else falls through to the web server. */
const API_PREFIX = "/api/";
/** Header the renderer stamps on every mutating call; a plain HTML form cannot set one. */
const TRANSPORT_HEADER = "x-agentforge-transport";
/** Routes that destroy local data, so they ask for the custom header on top of the Origin/Host checks. */
const TRANSPORT_REQUIRED_PATHS = new Set(["/api/v1/settings/reset"]);
/** Kept verbatim: the loopback rule's wording and code that the desktop and webdev already answer with. */
const LOCAL_ONLY_MESSAGE = "Local requests only";
const MISSING_TRANSPORT_MESSAGE = "Missing x-agentforge-transport header";
const ORIGIN_FORBIDDEN_MESSAGE = "Origin is not allowed to call this server";
/** Largest accepted request body (dataset uploads are 25 MB plus multipart framing). */
export const MAX_BODY_BYTES = 26 * 1024 * 1024;

/**
 * IDENTITY MASKING (Kyo: "masked HTTPS ... with the server's identity hidden").
 *
 * Headers that would name the software answering. Express sets `X-Powered-By` from its own init
 * middleware before this adapter is reached, so `app.disable("x-powered-by")` in apps/web/server.ts
 * is the fix and this removal is the floor under it: whatever is in front, an /api answer names no
 * framework and no version.
 */
const IDENTITY_HEADERS: readonly string[] = ["X-Powered-By", "Server"];

/** What a 5xx says in server mode. Fixed text: no path, no SQL, no module name, no stack. */
export const INTERNAL_ERROR_MESSAGE = "The server could not complete this request.";
const INTERNAL_ERROR_CODE = "internal_error";
/** A reason code is a lower-case token; anything else in that slot is not one and is replaced. */
const REASON_CODE_PATTERN = /^[a-z0-9_]+$/;

/** The proxy stamps this on everything it forwards; server mode answers nothing without it. */
const FORWARDED_PROTO_HEADER = "x-forwarded-proto";
const FORWARDED_FOR_HEADER = "x-forwarded-for";
const HTTPS_PROTO = "https";

/** One event name for every request the transport rules refuse, whatever refused it. */
const FILTERED_EVENT = "request_filtered";
/** Written when a handler escaped with an exception; the answer the caller gets says nothing. */
const FAILED_EVENT = "request_failed";
/**
 * Written when an /api call was answered 401 by the session gate
 * (docs/internal/security-owasp-2026-09.md, finding A09-2).
 *
 * Nothing used to record these: `router.ts` turns a failed session into an envelope and returns it,
 * and `auth/routes.ts` wraps every login, refresh and logout failure the same way. So a failed
 * sign-in, an expired or revoked session presented, `seat_cap_reached` and — the one that matters
 * most — `refresh_reused`, which is the portal's token-theft signal, all left no trace. There was
 * no line to alert on and nothing to reconstruct an incident from.
 *
 * The reason CODE is logged and nothing else that identifies anyone: no session id, no path, no
 * body. `log.ts` would drop a field named for a session anyway.
 */
const AUTH_FAILED_EVENT = "auth_failed";

/** Response header carrying the request id, so an app line and a proxy line can be joined. */
const REQUEST_ID_HEADER = "X-Request-Id";

/**
 * A short correlation id, minted per request (finding A09-1).
 *
 * `log.ts` has said "prefer log.child({ tenantId, requestId })" since it was written and nothing
 * ever minted one, so the Caddy access log and the app's own lines could not be joined and one
 * request's warnings could not be grouped. 8 bytes is plenty to tell concurrent requests apart in a
 * log window; it is not a secret and is deliberately not derived from anything about the caller.
 */
function mintRequestId(): string {
  return randomBytes(8).toString("hex");
}

const HTTPS_REQUIRED: HttpRejection = {
  status: 403,
  code: "https_required",
  message: "This server accepts HTTPS requests only.",
};

class BodyTooLarge extends Error {}
class BodyInvalidJson extends Error {}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function parseCookies(req: IncomingMessage): Record<string, string> {
  const raw = header(req, "cookie") ?? "";
  const out: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    const decoded = key ? decodeCookieValue(value) : null;
    if (key && decoded !== null) {
      out[key] = decoded;
    }
  }
  return out;
}

/**
 * A `Cookie` header is attacker-controlled, and `decodeURIComponent` throws a `URIError` on a broken
 * escape such as `x=%`. One malformed cookie must not turn every request into a 500, so that cookie
 * is treated as absent - which for the CSRF cookie means the honest `csrf_missing` answer.
 */
function decodeCookieValue(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/**
 * The base the request target is resolved against. Any fixed origin does: only the path and the
 * query are read back, never a host. It used to be `http://<Host header>`, which let a malformed
 * Host (`a b`, `[`, an empty value) throw `ERR_INVALID_URL` out of this adapter before any rule ran.
 */
const TARGET_PARSE_BASE = "http://localhost";

/** The request target would not parse at all, so it cannot even be classified as a page or an API call. */
const INVALID_TARGET: HttpRejection = {
  status: 400,
  code: "invalid_path",
  message: "The request path is not acceptable.",
};

/** RFC 9112 §3.2: a Host that is not `host[:port]` is a bad request, whatever path it names. */
const INVALID_HOST: HttpRejection = {
  status: 400,
  code: "invalid_host",
  message: "The Host header is not a valid host.",
};

/** The path and query of the request target, or null when it will not parse. Never reads Host, never throws. */
function requestTargetOf(req: IncomingMessage): { path: string; query: Record<string, string> } | null {
  let url: URL;
  try {
    url = new URL(req.url ?? "/", TARGET_PARSE_BASE);
  } catch {
    return null;
  }
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  return { path: url.pathname, query };
}

/** Characters that end an authority: a path, a query, a fragment, or userinfo before the `@`. */
const NON_AUTHORITY_CHARACTERS = new Set(["/", "\\", "?", "#", "@"]);

function hasNonAuthorityCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x20 || code === 0x7f || NON_AUTHORITY_CHARACTERS.has(character)) {
      return true;
    }
  }
  return false;
}

/**
 * True when a Host header is present and is not `host[:port]`.
 *
 * Absent is a different question and is not answered here: HTTP/1.0 may omit it, and the mutating
 * rules below already refuse a write that carries none. Present and empty, present with a space, a
 * slash, userinfo, an unclosed `[` or a port past 65535 is malformed. The character set is left to
 * the URL parser rather than a hand-written grammar, so a Docker service name such as `my_service`
 * still passes.
 */
export function isMalformedHostHeader(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0 || hasNonAuthorityCharacter(trimmed)) {
    return true;
  }
  try {
    new URL(`http://${trimmed}`);
    return false;
  } catch {
    return true;
  }
}

/**
 * One spelling per path, computed once and used by every check below and by the router.
 *
 * `dispatch` matches on the path with its trailing slashes stripped (router.ts), so a guard that
 * tested the raw path would miss `/api/v1/settings/reset/` while the handler still ran. Duplicate
 * slashes are collapsed for the same reason: they are the other way to spell one path.
 */
export function normaliseApiPath(raw: string): string {
  return raw.replace(/\/{2,}/g, "/").replace(/\/+$/, "") || "/";
}

async function readBody(req: IncomingMessage, method: string): Promise<{ body?: unknown; files?: HostFile[] }> {
  const contentType = header(req, "content-type") ?? "";
  if (method === "GET" || method === "HEAD") {
    return {};
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += piece.byteLength;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new BodyTooLarge("Request body exceeds the 26 MB cap");
    }
    chunks.push(piece);
  }
  const buffer = Buffer.concat(chunks);
  if (buffer.length === 0) {
    return {};
  }
  if (contentType.includes("multipart/form-data")) {
    const boundaryMatch = contentType.match(/boundary=([^;]+)/i);
    if (!boundaryMatch) {
      return {};
    }
    return parseMultipart(buffer, boundaryMatch[1].trim().replace(/^"|"$/g, ""));
  }
  if (contentType.includes("application/json")) {
    try {
      return { body: JSON.parse(buffer.toString("utf8")) };
    } catch {
      throw new BodyInvalidJson();
    }
  }
  return { body: buffer.toString("utf8") };
}

function parseMultipart(buffer: Buffer, boundary: string): { body?: unknown; files?: HostFile[] } {
  const list: HostFile[] = [];
  const rawBoundary = `--${boundary}`;
  const parts = buffer.toString("latin1").split(rawBoundary);
  for (const part of parts) {
    if (part === "--" || part === "--\r\n" || !part.toLowerCase().includes("content-disposition")) {
      continue;
    }
    const splitAt = part.indexOf("\r\n\r\n");
    if (splitAt === -1) {
      continue;
    }
    const headers = part.slice(0, splitAt);
    let body = part.slice(splitAt + 4);
    if (body.endsWith("\r\n")) {
      body = body.slice(0, -2);
    }
    const nameMatch = headers.match(/name="([^"]+)"/);
    const fileMatch = headers.match(/filename="([^"]+)"/);
    const typeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/i);
    if (!nameMatch) {
      continue;
    }
    if (fileMatch) {
      list.push({
        field: nameMatch[1],
        filename: fileMatch[1],
        mime: typeMatch?.[1]?.trim() || "application/octet-stream",
        bytes: Buffer.from(body, "latin1"),
      });
    }
  }
  return { files: list };
}

/**
 * Every `Set-Cookie` the answer carries: the handler's own cookies (the workspace cookie, which stays
 * `SameSite=Strict; HttpOnly`) plus any the adapter mints itself (the readable CSRF cookie). They are
 * written in one call because `setHeader` replaces rather than appends.
 */
function serialiseCookie(cookie: HostCookie): string {
  return [
    `${cookie.name}=${encodeURIComponent(cookie.value)}`,
    `Path=${cookie.path ?? "/"}`,
    ...(cookie.maxAge === undefined ? [] : [`Max-Age=${Math.max(0, Math.floor(cookie.maxAge))}`]),
    `SameSite=${cookie.sameSite ?? "Strict"}`,
    ...(cookie.httpOnly === false ? [] : ["HttpOnly"]),
    ...(cookie.secure ? ["Secure"] : []),
  ].join("; ");
}

function setCookieValues(result: HostResult, extra: readonly string[]): string[] {
  const fromResult = result.type === "json" ? (result.cookies ?? []).map(serialiseCookie) : [];
  return [...fromResult, ...extra];
}

export async function writeHostResult(
  res: ServerResponse,
  result: HostResult,
  extraCookies: readonly string[] = [],
): Promise<void> {
  const cookies = setCookieValues(result, extraCookies);
  if (cookies.length > 0) {
    res.setHeader("Set-Cookie", cookies);
  }
  if (result.type === "json") {
    res.statusCode = result.status;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.end(JSON.stringify(result.body));
    return;
  }
  if (result.type === "bytes") {
    res.statusCode = result.status;
    res.setHeader("Content-Type", result.contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (result.filename) {
      // Built rather than interpolated: a `"` in the name would otherwise start a parameter of its
      // own, and a non-Latin-1 character would make `setHeader` throw. See ./content-disposition.
      res.setHeader("Content-Disposition", contentDispositionAttachment(result.filename));
    }
    for (const [name, value] of Object.entries(result.headers ?? {})) {
      res.setHeader(name, value);
    }
    res.end(Buffer.from(result.bytes));
    return;
  }
  res.statusCode = result.status;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
  for await (const chunk of result.events) {
    res.write(chunk);
  }
  res.end();
}

/** A refusal that never reaches a handler: status, reason code and fixed text, plus Retry-After. */
export type HttpRejection = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly retryAfterSeconds?: number;
};

/** What a rejection is allowed to say about the request it refused. Never the path, never the body. */
type RequestContext = {
  readonly method: string;
  readonly pathLength: number;
  readonly ip: string | null;
  readonly serverMode: boolean;
  /** Correlation id for this request; on the response as `X-Request-Id`. */
  readonly requestId: string;
};

/**
 * The one way a refusal leaves this adapter: the `{error:{code,message}}` envelope, `nosniff`, and
 * one structured log line. Only server mode logs, so the desktop and webdev write exactly what they
 * always wrote.
 */
/**
 * Answer the liveness probe: one word, no cache, and nothing about this deployment.
 *
 * `Cache-Control: no-store` because a proxy that cached "ok" for sixty seconds would keep saying a
 * dead process is alive for sixty seconds, which is the only failure this route has. HEAD gets the
 * headers with the correct `Content-Length` and no body, because `docker healthcheck` and several
 * proxies probe with HEAD and a body on a HEAD response is a protocol error.
 *
 * Nothing is logged: this fires every few seconds for the life of the deployment, and a log line
 * per probe buries everything else.
 */
function respondLiveness(res: ServerResponse, method: string): true {
  const body = JSON.stringify(LIVENESS_BODY);
  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Length", String(Buffer.byteLength(body)));
  if (method === "HEAD") {
    res.end();
    return true;
  }
  res.end(body);
  return true;
}

function respondRejection(res: ServerResponse, rejection: HttpRejection, context: RequestContext): true {
  if (context.serverMode) {
    log.warn(FILTERED_EVENT, {
      code: rejection.code,
      status: rejection.status,
      method: context.method,
      pathLength: context.pathLength,
      ip: context.ip,
      requestId: context.requestId,
    });
  }
  res.statusCode = rejection.status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (rejection.retryAfterSeconds !== undefined) {
    res.setHeader("Retry-After", String(rejection.retryAfterSeconds));
  }
  res.end(JSON.stringify({ error: { code: rejection.code, message: rejection.message } }));
  return true;
}

/**
 * HTTPS-ONLY (server mode). The reverse proxy terminates TLS and stamps `X-Forwarded-Proto: https`
 * on every request it forwards, so the only caller that can lack it is something already inside the
 * box talking to the app's loopback port directly - which is exactly what must not be served.
 *
 * Phase 8 carves out exactly one exception, the liveness probe, because that caller is the whole
 * reason the probe exists: `docker healthcheck` runs inside the container and hits the app's own
 * loopback port with no proxy in front of it, and Caddy's upstream probe does the same. A liveness
 * route that only answered through the proxy could not tell an orchestrator that the app is dead
 * while the proxy is up, which is the one failure it is there to catch. Nothing else moves: the
 * request-line filter, the header cap, the method allowlist and the per-IP bucket all still run
 * over it (see `transportRejection`), and what it answers is a frozen one-word body that carries
 * nothing a plaintext hop could leak.
 */
function rejectPlaintext(req: IncomingMessage): HttpRejection | null {
  const proto = header(req, FORWARDED_PROTO_HEADER)?.split(",")[0]?.trim().toLowerCase();
  return proto === HTTPS_PROTO ? null : HTTPS_REQUIRED;
}

/**
 * Everything a hosted request must survive before the Origin, CSRF and session rules look at it:
 * the TLS hop, the shape of the request line and headers, then the rate limiters. Cheapest first,
 * and none of it reads the body.
 */
function transportRejection(
  req: IncomingMessage,
  path: string,
  method: string,
  ip: string | null,
  sessionKey: string | null,
  /** The liveness probe, which is exempt from the TLS hop alone. See `rejectPlaintext`. */
  allowPlaintext = false,
): HttpRejection | null {
  const rejection =
    (allowPlaintext ? null : rejectPlaintext(req)) ??
    filterHttpRequest({ method, url: req.url ?? "/", headers: req.headers, maxBodyBytes: MAX_BODY_BYTES });
  if (rejection) {
    return rejection;
  }
  const rate = checkRequestRate({ serverMode: true, path, ip, sessionKey });
  if (rate.allowed) {
    return null;
  }
  return {
    status: 429,
    code: RATE_LIMITED_CODE,
    message: RATE_LIMITED_MESSAGE,
    retryAfterSeconds: rate.retryAfterSeconds,
  };
}

/**
 * Masks a 5xx in server mode (Kyo: identity hidden). The reason code survives - the renderer and the
 * operator both need it - and everything else is replaced, because the detail on a 500 is where file
 * paths, SQL and module names leak. 4xx bodies are untouched: those messages are the honest reason
 * the caller asked for, and they are written by this repo rather than by a driver.
 */
export function maskServerError(result: HostResult, serverMode: boolean): HostResult {
  if (!serverMode || result.type !== "json" || result.status < 500) {
    return result;
  }
  return {
    type: "json",
    status: result.status,
    body: { error: { code: reasonCodeOf(result.body), message: INTERNAL_ERROR_MESSAGE } },
    cookies: result.cookies,
  };
}

function reasonCodeOf(body: unknown): string {
  const envelope = (body as { error?: unknown } | null | undefined)?.error;
  const code = typeof envelope === "object" && envelope !== null ? (envelope as { code?: unknown }).code : undefined;
  return typeof code === "string" && REASON_CODE_PATTERN.test(code) ? code : INTERNAL_ERROR_CODE;
}

let editBooted = false;

export async function handleNodeRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // Null when the target will not parse. Nothing below may throw on a request's own bytes: the
  // answer to a malformed request is a 400 from here, not an exception for the web server to catch.
  const target = requestTargetOf(req);
  const rawPath = target?.path ?? null;
  const query = target?.query ?? {};
  // The "is this ours to answer" test stays on the raw path: normalising only removes slashes, so it
  // can never turn a non-/api path into an /api one, and the set of requests this adapter DISPATCHES
  // is unchanged. The transport rules below are deliberately not gated on it.
  const isApiPath = rawPath?.startsWith(API_PREFIX) ?? false;
  // One switch decides which rule this process runs: the hosted web rule or the local loopback rule.
  const serverMode = isServerMode();
  /*
   * Phase 8 — the liveness probe, and the one path outside `/api` this adapter answers.
   *
   * It lives here rather than in the router's table because that table is `/api`-only and
   * `dispatch` never sees another path. That is also what keeps it out of the hosted session gate
   * BY CONSTRUCTION rather than by an entry in an exemption set: there is no code path from here
   * into `requireSessionFor`, so it cannot be gated by accident and cannot be un-gated by an
   * edit somewhere else. Its body is a frozen literal with one word in it (handlers/health.ts) —
   * the readiness detail an operator wants is `GET /api/v1/health`, behind a session.
   *
   * It is answered AFTER the transport filter below in server mode, so the request-line filter,
   * the method allowlist, the header cap and the per-IP bucket all apply to it exactly as they do
   * to everything else on the socket. The one rule it is exempt from is the TLS hop, because the
   * caller it exists for — the container healthcheck, and Caddy's own upstream probe — is inside
   * the box hitting the loopback port with no proxy in front of it; see `rejectPlaintext`. Only
   * GET and HEAD are recognised; any other verb falls through to the page server, which is where
   * an unrecognised path belongs.
   */
  // Upper-cased once: every method test below, the liveness test here and the body reader must all
  // agree on the verb.
  const method = (req.method ?? "GET").toUpperCase();
  const isLiveness =
    rawPath !== null &&
    (method === "GET" || method === "HEAD") &&
    (rawPath.replace(/\/+$/, "") || "/") === LIVENESS_PATH;
  // Decided before the page / API split and in both modes: a target that will not parse cannot be
  // told apart as either, and a Host that is not `host[:port]` is a bad request whatever it names.
  // Both used to throw out of this function (see `TARGET_PARSE_BASE`); they are answered below, in
  // server mode only after the TLS rule and the buckets, so neither is an unmetered socket.
  const malformed =
    rawPath === null ? INVALID_TARGET : isMalformedHostHeader(header(req, "host")) ? INVALID_HOST : null;
  // Off server mode nothing here applies to a well-formed page or asset request, so the desktop
  // shell and webdev see exactly the early return they always saw: no bucket, no log line. The probe
  // is the one addition, and it answers in both modes so a developer can point the same healthcheck
  // at webdev as at the container.
  if (!serverMode && !isApiPath && !malformed) {
    return isLiveness ? respondLiveness(res, method) : false;
  }
  for (const name of IDENTITY_HEADERS) {
    res.removeHeader(name);
  }
  // Before anything else writes a header, and for EVERY request this adapter is handed — the page
  // and the built bundles included, which is why it is here and not only on the /api answers. A
  // route that needs something stricter still wins: a handler's own headers are applied after
  // these (see `writeHostResult`). Off server mode this is a no-op. See ./security-headers.
  applySecurityHeaders(res, serverMode);
  // An unparseable target has no path; the empty one keeps it out of every path-keyed rule below.
  const path = rawPath === null ? "" : normaliseApiPath(rawPath);
  const cookies = parseCookies(req);
  const csrfMode = { secure: serverMode };
  const ip = clientIp({
    forwardedFor: header(req, FORWARDED_FOR_HEADER),
    remoteAddress: req.socket?.remoteAddress,
    serverMode,
  });
  const requestId = mintRequestId();
  if (serverMode) {
    res.setHeader(REQUEST_ID_HEADER, requestId);
  }
  // The session id the browser presents, unverified — the router's gate is what verifies it. That is
  // enough to bind a CSRF token to: a bogus id gets a token nobody else holds, and the request is
  // 401'd a frame later anyway.
  const presentedSessionId = cookies[sessionCookieName({ secure: serverMode })] ?? null;
  const context: RequestContext = {
    method,
    pathLength: rawPath === null ? (req.url ?? "").length : path.length,
    ip,
    serverMode,
    requestId,
  };
  /*
   * Transport filtering runs first, for EVERY request this adapter is handed and not just the /api
   * ones: the page, the built bundles and every 404 probe arrive through the same socket, and a
   * control that skipped them would leave the TLS rule, the method allowlist, the path filter, the
   * header cap and the per-IP bucket off the bulk of the traffic. Only the Origin / CSRF / session
   * rules below stay API-only - those are about a call the renderer makes, not about the hop it
   * arrived on. (The body's declared `Content-Type` rides along inside `filterHttpRequest`; no
   * non-/api route of this app takes a body, so the only thing it can refuse there is a probe.)
   *
   * This works because apps/web/server.ts mounts `handleNodeRequest` as its FIRST middleware, above
   * `express.static` and the vite middlewares, so a page request reaches here before anything serves
   * it. If that mount ever moves, these controls move with it.
   */
  if (serverMode) {
    const sessionKey = sessionRateKey(presentedSessionId ?? undefined);
    const rejection = transportRejection(req, path, method, ip, sessionKey, isLiveness);
    if (rejection) {
      return respondRejection(res, rejection, context);
    }
  }
  if (malformed) {
    return respondRejection(res, malformed, context);
  }
  if (isLiveness) {
    return respondLiveness(res, method);
  }
  // Clean, but not ours: the web server serves the page or the asset from here.
  if (!isApiPath) {
    return false;
  }
  if (!editBooted) {
    editBooted = true;
    const { handleBootEditJobs } = await import("./handlers/edit");
    void handleBootEditJobs();
  }
  if (!SAFE_METHODS.has(method) && !CSRF_EXEMPT_PATHS.has(path)) {
    const rejection = mutatingRejection(req, path, cookies, csrfMode, presentedSessionId);
    if (rejection) {
      return respondRejection(res, { status: 403, ...rejection }, context);
    }
  }
  // Minted in every mode so the renderer's echo path is exercised on webdev too; only the hosted
  // server enforces it, so webdev and the desktop keep behaving exactly as before.
  //
  // Re-minted, not only minted: a token is bound to a session id (`./csrf.ts`), so the cookie a
  // browser carries from before it signed in — or from before this process restarted — no longer
  // verifies, and without a re-mint every mutating call would 403 with nothing able to fix it.
  const csrfCookie = readCsrfCookie(cookies, csrfMode);
  const csrfNeedsMint = !csrfCookie || !csrfTokenMatchesSession(csrfCookie, presentedSessionId);
  const mintedCookies =
    method === "GET" && csrfNeedsMint ? [csrfSetCookie(mintCsrfTokenFor(presentedSessionId), csrfMode)] : ([] as const);
  let parsed: { body?: unknown; files?: HostFile[] };
  try {
    parsed = await readBody(req, method);
  } catch (error) {
    if (error instanceof BodyTooLarge) {
      return respondRejection(res, { status: 413, code: "payload_too_large", message: error.message }, context);
    }
    if (error instanceof BodyInvalidJson) {
      const rejection = { status: 400, code: "invalid_json", message: "Request body is not valid JSON" };
      return respondRejection(res, rejection, context);
    }
    throw error;
  }
  const { body, files } = parsed;
  // A client that goes away mid-stream aborts the run (same as the desktop IPC path), so a live model
  // call is not left running for nobody and `res.write` never hits a destroyed socket.
  const abort = new AbortController();
  res.on("close", () => {
    if (!res.writableFinished) {
      abort.abort(new Error("client_disconnected"));
    }
  });
  const request: HostRequest = {
    method,
    path,
    query,
    params: {},
    headers: {
      origin: header(req, "origin"),
      referer: header(req, "referer"),
      cookie: header(req, "cookie"),
      "content-type": header(req, "content-type"),
      range: header(req, "range"),
      // Phase 5 lane B: the billing webhook's shared secret. Forwarded like the others rather than
      // read from the raw request inside the handler, so the handler stays adapter-agnostic and
      // the desktop IPC path — which never carries it — reads `undefined` and refuses.
      [BILLING_TOKEN_HEADER]: header(req, BILLING_TOKEN_HEADER),
      "x-agentforge-transport": "http",
    },
    body,
    files,
    workspaceId: cookies[WORKSPACE_COOKIE] || readSelectedWorkspaceId() || null,
    abortSignal: abort.signal,
  };
  const result = await dispatchMasked(request, context);
  await writeHostResult(res, result, mintedCookies);
  return true;
}

/**
 * `dispatch` already turns every handler failure into an envelope (router.ts), so the catch here is
 * the belt to that brace: an exception thrown on the way in or out would otherwise reach Express and
 * be answered with its default HTML error page, stack trace and all. In server mode it becomes the
 * same masked 500 as any other; off server mode it is rethrown, so webdev's error path is untouched.
 */
async function dispatchMasked(request: HostRequest, context: RequestContext): Promise<HostResult> {
  try {
    const result = maskServerError(await dispatch(request), context.serverMode);
    logAuthFailure(result, context);
    return result;
  } catch (error) {
    if (!context.serverMode) {
      throw error;
    }
    log.error(FAILED_EVENT, {
      code: INTERNAL_ERROR_CODE,
      method: context.method,
      pathLength: context.pathLength,
      ip: context.ip,
      requestId: context.requestId,
      error,
    });
    return {
      type: "json",
      status: 500,
      body: { error: { code: INTERNAL_ERROR_CODE, message: INTERNAL_ERROR_MESSAGE } },
    };
  }
}

/**
 * One line per 401, with the reason code the session gate chose and nothing that identifies the
 * caller beyond the client IP the rate limiter already keys on. See `AUTH_FAILED_EVENT`.
 */
function logAuthFailure(result: HostResult, context: RequestContext): void {
  if (!context.serverMode || result.type !== "json" || result.status !== 401) {
    return;
  }
  log.warn(AUTH_FAILED_EVENT, {
    code: reasonCodeOf(result.body),
    method: context.method,
    pathLength: context.pathLength,
    ip: context.ip,
    requestId: context.requestId,
  });
}

type Rejection = { readonly code: string; readonly message: string };

/**
 * The one place the two rules are chosen between (docs/internal/web-migration-plan.md Phase 1).
 *
 * Off server mode: the local rule, unchanged — a missing Origin is same-machine and the Host must be
 * loopback. In server mode: the Origin must be on the configured allowlist (a missing one is
 * rejected), the Host must be one of those origins' hosts, and the double-submit CSRF token must
 * match. The `x-agentforge-transport` requirement on the destructive routes is unchanged in both.
 */
/**
 * Phase 5 lane B: paths a mutating request may reach without an Origin on the allowlist and
 * without a CSRF token (decision doc §3(c), the first of the webhook's three exemptions).
 *
 * The double-submit CSRF rule and the Origin allowlist both assume a BROWSER made the request.
 * A payment provider's server sends neither header and has no cookie jar, so the rule it is held
 * to instead is a shared secret compared in constant time, checked inside the handler
 * (`billing/authenticate.ts`) — which also means an unconfigured deployment refuses rather than
 * accepting anything. One literal path, never a prefix: `/api/v1/billing/top-up` is a browser
 * call and keeps every rule.
 */
const CSRF_EXEMPT_PATHS: ReadonlySet<string> = new Set(["/api/v1/billing/webhook"]);

function mutatingRejection(
  req: IncomingMessage,
  path: string,
  cookies: Record<string, string>,
  csrfMode: CsrfMode,
  sessionId: string | null,
): Rejection | null {
  const origin = header(req, "origin");
  const host = header(req, "host");
  // The hosted deployment is the HTTPS one, so one flag carries both meanings: it selects the web
  // rules here and the `Secure` / `__Host-` cookie those rules check.
  const serverMode = csrfMode.secure;
  if (serverMode) {
    const allowlist = trustedOrigins();
    if (!isAllowedWebOrigin(origin, allowlist) || !isAllowedWebHostHeader(host, allowlist)) {
      return { code: "origin_forbidden", message: ORIGIN_FORBIDDEN_MESSAGE };
    }
    const csrf = checkCsrfToken(cookies, header(req, CSRF_HEADER), csrfMode, sessionId);
    if (!csrf.ok) {
      return { code: csrf.code, message: csrf.message };
    }
  } else if (!isAllowedMutatingApiRequest(origin, header(req, "referer")) || !isLoopbackHostHeader(host)) {
    return { code: "forbidden", message: LOCAL_ONLY_MESSAGE };
  }
  // The reset routes wipe local data, so they also demand a header no cross-site HTML form can send.
  if (TRANSPORT_REQUIRED_PATHS.has(path) && !header(req, TRANSPORT_HEADER)?.trim()) {
    return { code: "forbidden", message: MISSING_TRANSPORT_MESSAGE };
  }
  return null;
}
