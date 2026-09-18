import { normaliseOrigin } from "@agentforge/core";

function hostnameOf(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    try {
      return new URL(`http://${trimmed}`).hostname.toLowerCase();
    } catch {
      return null;
    }
  }
}

/** True when the host is this machine's loopback name. */
export function isLocalRequestHost(host: string | null | undefined): boolean {
  if (!host) {
    return false;
  }
  const hostname = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "");
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

/** True when Origin or Referer points at localhost / 127.0.0.1. */
export function isLocalRequestUrl(originOrReferer: string | null | undefined): boolean {
  if (!originOrReferer) {
    return false;
  }
  return isLocalRequestHost(hostnameOf(originOrReferer));
}

/** Loopback names a Host header may carry; anything else names a different machine. */
const LOOPBACK_HOST_NAMES = new Set(["localhost", "127.0.0.1", "::1"]);

/** Strips the optional `:port` from a Host header value, or returns null when it is not a host[:port]. */
function hostNameOfHeader(value: string): string | null {
  if (value.startsWith("[")) {
    const bracketed = value.match(/^\[([0-9a-f:.]+)\](?::\d{1,5})?$/);
    return bracketed ? bracketed[1] : null;
  }
  const named = value.match(/^([^:]+)(?::\d{1,5})?$/);
  if (named) {
    return named[1];
  }
  // A bare IPv6 literal carries no port, so the remaining colons are part of the address itself.
  return /^[0-9a-f:.]+$/.test(value) ? value : null;
}

/**
 * True when the Host header names this machine's loopback interface, with or without a port.
 *
 * A MISSING Host is rejected, unlike a missing Origin. Origin is genuinely absent from plenty of
 * honest local clients (curl, native tooling, same-origin GETs), so its absence carries no signal.
 * Host is different: HTTP/1.1 makes it mandatory, and every real client on loopback — browsers,
 * curl, fetch, Node's own http.request — sends it. So a missing Host is a malformed request rather
 * than a hint of trusted local tooling, and trusting it would hand an attacker a one-header bypass
 * of this check. Rejecting it costs no legitimate caller anything.
 */
export function isLoopbackHostHeader(host: string | null | undefined): boolean {
  const value = host?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  const hostname = hostNameOfHeader(value);
  return hostname !== null && LOOPBACK_HOST_NAMES.has(hostname);
}

/**
 * Mutating /api calls: missing Origin is treated as same-machine (curl, native).
 * When Origin is present, its host must be localhost or 127.0.0.1.
 * A remote Origin is never allowed, even if Referer is local.
 */
export function isAllowedMutatingApiRequest(
  origin: string | null | undefined,
  _referer?: string | null | undefined,
): boolean {
  const source = origin?.trim();
  if (!source) {
    return true;
  }
  return isLocalRequestUrl(source);
}

/**
 * The web rule, for the hosted server (docs/internal/web-security-spec.md A1).
 *
 * Unlike the loopback rule above, a MISSING Origin is rejected: on a public server there is no
 * "same machine" to infer, and every browser sends an Origin on a mutating cross-document request.
 * The comparison is on the whole normalised `scheme://host[:port]`, so a different scheme or port is
 * a different origin, and an empty allowlist (an unconfigured server) accepts nothing.
 */
export function isAllowedWebOrigin(origin: string | null | undefined, allowlist: readonly string[]): boolean {
  const candidate = normaliseOrigin(origin);
  if (!candidate) {
    return false;
  }
  return allowlist.some((entry) => normaliseOrigin(entry) === candidate);
}

/**
 * The Host-header half of the web rule: the public host the proxy forwards, instead of loopback.
 *
 * A Host may carry the default port explicitly (`app.example.com:443` for an https origin), so that
 * spelling is accepted too; any other port, or any other name, is a different server.
 */
export function isAllowedWebHostHeader(host: string | null | undefined, allowlist: readonly string[]): boolean {
  const value = host?.trim().toLowerCase();
  if (!value) {
    return false;
  }
  return allowedHostHeaders(allowlist).has(value);
}

const DEFAULT_PORTS: Readonly<Record<string, string>> = { "http:": "80", "https:": "443" };

function allowedHostHeaders(allowlist: readonly string[]): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const entry of allowlist) {
    const origin = normaliseOrigin(entry);
    if (!origin) {
      continue;
    }
    const url = new URL(origin);
    hosts.add(url.host);
    if (!url.port) {
      hosts.add(`${url.hostname}:${DEFAULT_PORTS[url.protocol]}`);
    }
  }
  return hosts;
}

/* ------------------------------------------------------------------------------------------------
 * HTTP request filtering (docs/internal/web-security-spec.md; "masked HTTPS and HTTP filtering").
 *
 * Every hosted request is run past these before the Origin, CSRF and session rules and long before a
 * handler sees it. They are pure predicates over the request line and the headers: no body is read,
 * nothing is logged here, and the caller turns a rejection into the JSON envelope. Off server mode
 * none of this runs - the desktop and webdev keep the loopback rule they always had.
 * ---------------------------------------------------------------------------------------------- */

/** The verbs the app speaks. TRACE / TRACK / CONNECT and the WebDAV family are refused. */
export const ALLOWED_METHODS: ReadonlySet<string> = new Set([
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "OPTIONS",
]);

/** Longest accepted path. The app's own longest route plus an id is well under a tenth of this. */
export const MAX_REQUEST_PATH_LENGTH = 2048;

/** Most query parameters any route reads is a handful; 32 is generous and bounds the parse. */
export const MAX_QUERY_PARAMS = 32;

/** Per-header cap. Node already caps the whole header block at 16 KB; this bounds one of them. */
export const MAX_HEADER_BYTES = 8 * 1024;

/** The only media types a body may declare. A form post is deliberately not one of them. */
export const ALLOWED_BODY_CONTENT_TYPES: readonly string[] = ["application/json", "multipart/form-data", "text/plain"];

/** Methods that never carry a body the app would parse, so they are not asked for a Content-Type. */
const BODYLESS_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

export type HttpFilterRejection = {
  readonly status: number;
  readonly code: string;
  /** Fixed text. Never echoes any part of the request, so a rejection cannot become a reflector. */
  readonly message: string;
};

export type HttpFilterInput = {
  /** Already upper-cased by the caller. */
  readonly method: string;
  /** The raw request target, path and query together, exactly as it came off the wire. */
  readonly url: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly maxBodyBytes: number;
};

const METHOD_NOT_ALLOWED: HttpFilterRejection = {
  status: 405,
  code: "method_not_allowed",
  message: "That HTTP method is not accepted here.",
};
const INVALID_PATH: HttpFilterRejection = {
  status: 400,
  code: "invalid_path",
  message: "The request path is not acceptable.",
};
const TOO_MANY_QUERY_PARAMS: HttpFilterRejection = {
  status: 400,
  code: "too_many_query_params",
  message: "The request has too many query parameters.",
};
const HEADER_TOO_LARGE: HttpFilterRejection = {
  status: 431,
  code: "header_too_large",
  message: "A request header is too large.",
};
const PAYLOAD_TOO_LARGE: HttpFilterRejection = {
  status: 413,
  code: "payload_too_large",
  message: "The request body is larger than this server accepts.",
};
const UNSUPPORTED_MEDIA_TYPE: HttpFilterRejection = {
  status: 415,
  code: "unsupported_media_type",
  message: "That content type is not accepted here.",
};

export function isAllowedMethod(method: string): boolean {
  return ALLOWED_METHODS.has(method);
}

/**
 * The whole filter, in the order a cheap check should come first. Returns the rejection to answer
 * with, or null when the request may go on to the Origin / CSRF / session rules.
 */
export function filterHttpRequest(input: HttpFilterInput): HttpFilterRejection | null {
  if (!isAllowedMethod(input.method)) {
    return METHOD_NOT_ALLOWED;
  }
  return rejectRequestTarget(input.url) ?? rejectHeaderSizes(input.headers) ?? rejectBodyDeclaration(input);
}

/** True when the request target carries a raw control character; a request line never does. */
function hasControlCharacter(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** `%00`, `%2f` and `%5c`: a NUL and the two slashes that a later decode would turn into separators. */
const ENCODED_SEPARATORS = /%(00|2f|5c)/i;
/** `%2e` is the only other spelling of the dot a `..` segment is made of. */
const ENCODED_DOT = /%2e/gi;

export function rejectRequestTarget(url: string): HttpFilterRejection | null {
  if (hasControlCharacter(url)) {
    return INVALID_PATH;
  }
  const queryAt = url.indexOf("?");
  const path = queryAt === -1 ? url : url.slice(0, queryAt);
  if (path.length > MAX_REQUEST_PATH_LENGTH || path.includes("\\") || ENCODED_SEPARATORS.test(path)) {
    return INVALID_PATH;
  }
  if (path.split("/").some(isDotDotSegment)) {
    return INVALID_PATH;
  }
  const query = queryAt === -1 ? "" : url.slice(queryAt + 1);
  if (query !== "" && query.split("&").length > MAX_QUERY_PARAMS) {
    return TOO_MANY_QUERY_PARAMS;
  }
  return null;
}

function isDotDotSegment(segment: string): boolean {
  return segment.replace(ENCODED_DOT, ".") === "..";
}

export function rejectHeaderSizes(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
): HttpFilterRejection | null {
  for (const [name, value] of Object.entries(headers)) {
    const values = value === undefined ? [] : Array.isArray(value) ? value : [value as string];
    for (const one of values) {
      if (Buffer.byteLength(name, "utf8") + Buffer.byteLength(one, "utf8") > MAX_HEADER_BYTES) {
        return HEADER_TOO_LARGE;
      }
    }
  }
  return null;
}

/**
 * The two body checks, which only make sense together: a declared length past the cap is refused
 * before a byte is read, and a body - declared by a length or by chunked encoding - must name a
 * media type this app parses. A Content-Type on a mutating request is checked even without a
 * declared length, because `application/x-www-form-urlencoded` is the cross-site form shape whether
 * or not the sender bothered to measure it.
 */
function rejectBodyDeclaration(input: HttpFilterInput): HttpFilterRejection | null {
  const declared = Number(firstHeader(input.headers, "content-length"));
  if (Number.isFinite(declared) && declared > input.maxBodyBytes) {
    return PAYLOAD_TOO_LARGE;
  }
  if (BODYLESS_METHODS.has(input.method)) {
    return null;
  }
  const contentType = firstHeader(input.headers, "content-type")?.trim();
  const hasBody =
    (Number.isFinite(declared) && declared > 0) || firstHeader(input.headers, "transfer-encoding") !== undefined;
  if (!contentType) {
    return hasBody ? UNSUPPORTED_MEDIA_TYPE : null;
  }
  const media = contentType.split(";")[0].trim().toLowerCase();
  return ALLOWED_BODY_CONTENT_TYPES.includes(media) ? null : UNSUPPORTED_MEDIA_TYPE;
}

function firstHeader(
  headers: Readonly<Record<string, string | readonly string[] | undefined>>,
  name: string,
): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : (value as string | undefined);
}
