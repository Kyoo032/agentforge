import { lookup as dnsLookup } from "node:dns/promises";
import { ApiError } from "../errors";
import { isPrivateHostname, isPrivateIpAddress, parseIpAddress } from "./ip-range";

export const SAFE_FETCH_MAX_HOPS = 5;
export const SAFE_FETCH_DEFAULT_MAX_BYTES = 1_500_000;
export const SAFE_FETCH_DEFAULT_TIMEOUT_MS = 15_000;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const USER_AGENT = "DPSBuddy/1.0 (local research reader)";

/** What `dns.lookup(host, { all: true })` hands back; narrowed to the one field this file reads. */
export type ResolvedAddress = { readonly address: string };

/** Injected by the tests so a suite never depends on a resolver being reachable. */
export type HostLookup = (hostname: string) => Promise<readonly ResolvedAddress[]>;

export type SafeFetchOptions = {
  fetchImpl?: typeof fetch;
  /** Resolver used for the private-address check; defaults to the system one. */
  lookupImpl?: HostLookup;
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

/**
 * The literal half of the check: an address the server must not reach, or a name that by convention
 * points at this machine or this network.
 *
 * Address ranges live in `./ip-range`, on bytes rather than on text. The list of string prefixes
 * this used to be had two holes that a prefix list cannot close: `[::ffff:127.0.0.1]` and
 * `[::ffff:169.254.169.254]` (IPv4-mapped IPv6, which the stack connects to the embedded IPv4
 * address) read as public, and so did 100.64.0.0/10, where a cloud provider's internal endpoints
 * live. It also refused the public domain `fdic.gov` for starting with `fd`.
 */
function isPrivateHost(hostname: string): boolean {
  const address = parseIpAddress(hostname);
  return address ? isPrivateIpAddress(address) : isPrivateHostname(hostname);
}

/**
 * Public HTTPS only: no credentials, no loopback, no private ranges. Applied to every redirect hop.
 *
 * LEXICAL ONLY. A hostname that *resolves* to a private address passes this — `localtest.me`,
 * `<anything>.nip.io`, or an attacker's own domain with an A record of 169.254.169.254. The name
 * has to be resolved for that, which is asynchronous, so `fetchPublicHttps` does it separately in
 * `assertResolvesPublic` below and this function stays synchronous for the callers that use it as
 * an early, cheap rejection.
 */
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

const defaultLookup: HostLookup = (hostname) => dnsLookup(hostname, { all: true });

/**
 * The resolving half of the check: every address this hostname answers with must be public.
 *
 * WHAT THIS CLOSES. `assertPublicHttpsUrl` reads the hostname as text, so a name that resolves to a
 * private address sailed through it: `localtest.me` (public DNS, answers 127.0.0.1), any
 * `<ip>.nip.io`, or simply an attacker's own domain with an A record of 169.254.169.254 — the
 * metadata service of the VM this runs on. `POST /api/v1/knowledge/sources/url` stores and shows the
 * fetched body back, so that was a read primitive against the box's own network, not a blind one.
 *
 * WHAT THIS DOES NOT CLOSE, stated plainly. The address is validated here and the URL is then handed
 * to `fetch`, which resolves the name a second time. A resolver the attacker controls can answer
 * differently on the two calls (DNS rebinding). Closing that needs the socket's own address, i.e. a
 * custom `undici` dispatcher with a pinned `lookup`, which is a dependency this package does not
 * have. Recorded as an open finding rather than papered over.
 *
 * A resolution FAILURE is not a refusal: if the name does not resolve for us it will not resolve for
 * `fetch` either, so there is nothing to protect against, and failing closed here would make every
 * offline test and every transient DNS blip an `invalid_endpoint` error instead of a network error.
 * Only a successful resolution to a private address refuses.
 */
export async function assertResolvesPublic(hostname: string, lookupImpl: HostLookup = defaultLookup): Promise<void> {
  // An IP literal has no name to resolve; `assertPublicHttpsUrl` already judged it on its bytes.
  if (parseIpAddress(hostname)) {
    return;
  }
  let resolved: readonly ResolvedAddress[];
  try {
    resolved = await lookupImpl(hostname);
  } catch {
    return;
  }
  for (const { address } of resolved) {
    const parsed = parseIpAddress(address);
    if (parsed && isPrivateIpAddress(parsed)) {
      // The address is deliberately NOT in the message: it is the one piece of the answer an
      // attacker probing internal ranges would want back.
      throw new ApiError("invalid_endpoint", "URL must point at a public host", 400);
    }
  }
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
    let parsed = assertPublicHttpsUrl(url.trim());
    let current = parsed.toString();
    for (let hop = 0; hop <= maxHops; hop += 1) {
      // Per hop, not once: a redirect names a new host, and that host gets resolved and judged too.
      await assertResolvesPublic(parsed.hostname, options.lookupImpl);
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
        parsed = new URL(next);
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
