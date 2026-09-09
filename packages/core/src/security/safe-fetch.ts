import { ApiError } from "../errors";
import { isLoopbackHost } from "./tls";

export const SAFE_FETCH_MAX_HOPS = 5;
export const SAFE_FETCH_DEFAULT_MAX_BYTES = 1_500_000;
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const PRIVATE_IPV4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];
const USER_AGENT = "DPSBuddy/1.0 (local research reader)";

export type SafeFetchOptions = {
  fetchImpl?: typeof fetch;
  maxHops?: number;
  maxBytes?: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Caller's abort signal (a cancelled job); combined with the timeout. */
  signal?: AbortSignal;
};

export type SafeFetchResult = {
  finalUrl: string;
  status: number;
  contentType: string;
  body: Buffer;
};

function isPrivateHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopbackHost(host) || host === "0.0.0.0" || host.endsWith(".localhost") || host.endsWith(".local")) {
    return true;
  }
  if (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:") || host === "::") {
    return true;
  }
  return PRIVATE_IPV4.some((range) => range.test(host));
}

/** Public HTTPS only: no credentials, no loopback, no private ranges. Applied to every redirect hop. */
export function assertPublicHttpsUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ApiError("invalid_endpoint", "URL is not valid", 400);
  }
  if (parsed.protocol !== "https:") {
    throw new ApiError("invalid_endpoint", "URL must use HTTPS", 400);
  }
  if (parsed.username || parsed.password) {
    throw new ApiError("invalid_endpoint", "URL must not contain credentials", 400);
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new ApiError("invalid_endpoint", "URL must point at a public host", 400);
  }
  return parsed;
}

/** Resolve a redirect target against the hop it came from, then re-validate it. */
export function nextHopUrl(from: string, location: string | null): string | null {
  if (!location) {
    return null;
  }
  return assertPublicHttpsUrl(new URL(location, from).toString()).toString();
}

async function readCapped(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.alloc(0);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new ApiError("invalid_request", `URL body exceeds ${Math.round((maxBytes / 1_000_000) * 10) / 10} MB`, 400);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

function linkSignals(options: SafeFetchOptions): { controller: AbortController; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SAFE_FETCH_DEFAULT_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  options.signal?.addEventListener("abort", onOuterAbort, { once: true });
  return {
    controller,
    dispose: () => {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);
    },
  };
}

/**
 * Fetch a public HTTPS URL, following redirects manually so every hop passes the
 * same host/protocol checks, with a timeout and a byte cap on the body.
 */
export async function fetchPublicHttps(url: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const maxHops = options.maxHops ?? SAFE_FETCH_MAX_HOPS;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_DEFAULT_MAX_BYTES;
  const { controller, dispose } = linkSignals(options);
  try {
    let current = assertPublicHttpsUrl(url.trim()).toString();
    for (let hop = 0; hop <= maxHops; hop += 1) {
      const response = await fetchImpl(current, {
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, ...options.headers },
      });
      if (REDIRECT_STATUSES.has(response.status)) {
        const next = nextHopUrl(current, response.headers.get("location"));
        if (!next) {
          throw new ApiError("invalid_request", `Redirect without a location (${response.status})`, 400);
        }
        current = next;
        continue;
      }
      return {
        finalUrl: current,
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body: await readCapped(response, maxBytes),
      };
    }
    throw new ApiError("invalid_request", `Too many redirects (more than ${maxHops})`, 400);
  } catch (error) {
    if (options.signal?.aborted) {
      throw new ApiError("aborted", "URL fetch cancelled", 499);
    }
    if (controller.signal.aborted) {
      throw new ApiError("invalid_request", "URL fetch timed out", 400);
    }
    throw error;
  } finally {
    dispose();
  }
}
