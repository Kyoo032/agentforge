import { apiFetch } from "@/lib/api-client";

/**
 * `GET /api/v1/ping`, fetched once per page load and shared.
 *
 * Two providers now read this payload — the brand and the capabilities — and before Phase 8 the
 * brand fetched it on its own. A second provider with a second `fetch` would be two requests for
 * one unchanging answer on every boot, and worse, two answers: the CSRF cookie is minted on the
 * first `/api` GET, so two in flight together race to mint it and one of them loses its token.
 *
 * The promise is memoised, not the value, so a caller that mounts while the first request is still
 * in the air waits on the same request rather than starting another. A failure is memoised too:
 * ping does not become available later in the same page load, and retrying it per consumer would
 * turn one failed boot into a retry storm. The packaged desktop preload already supplied the brand
 * and every capability defaults closed, so a failure degrades rather than breaks.
 */
let pending: Promise<unknown> | null = null;

export function pingOnce(): Promise<unknown> {
  pending ??= apiFetch("/api/v1/ping")
    .then((res) => res.json() as Promise<unknown>)
    .catch(() => null);
  return pending;
}

/** Test seam: forget the memoised answer, which is what a fresh page load looks like. */
export function resetPingForTests(): void {
  pending = null;
}
