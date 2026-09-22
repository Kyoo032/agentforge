/**
 * One place the whole renderer learns that its session is gone.
 *
 * The session is a cookie: it can end between two calls, because it was revoked by an admin, idled
 * out, or outlived a host restart. Every later call then answers `401` with a reason code
 * (`packages/host/src/router.ts` gates before the route table, so it happens to reads too). Without
 * this the app would keep drawing a desk whose every request fails.
 *
 * Deliberately a listener set rather than a `window` event: this is renderer-internal wiring, no
 * page script has any business in it, and a plain function is the same three lines in a test as in
 * a browser. `api-client` calls `noteApiResponse` on every HTTP answer and knows nothing else about
 * sessions; `lib/session.tsx` subscribes and is the only module that acts.
 */
import { errorCodeFrom } from "@/lib/auth-reason";

export type SessionLostListener = (code: string | null) => void;

const listeners = new Set<SessionLostListener>();

/** Subscribe. Returns the unsubscribe, so an effect can return it directly. */
export function onSessionLost(listener: SessionLostListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function announceSessionLost(code: string | null): void {
  for (const listener of [...listeners]) {
    listener(code);
  }
}

/**
 * A 401 from any call, reported once, without disturbing the caller's own body.
 *
 * `clone()` is what keeps this honest: the response the caller gets back is untouched and still
 * unread, so a handler that parses its own error envelope still can. Nothing is read at all unless
 * the status is 401 and somebody is listening, which on the desk and on webdev is nobody.
 */
export function noteApiResponse(response: Response): void {
  if (response.status !== 401 || listeners.size === 0 || typeof response.clone !== "function") {
    return;
  }
  void response
    .clone()
    .json()
    .then((body: unknown) => {
      announceSessionLost(errorCodeFrom(body));
    })
    .catch(() => {
      // A 401 with no readable body says nothing about which session ended; leave the state alone.
    });
}

/** Test seam: drop every subscriber, which is what a fresh page load looks like. */
export function resetSessionSignalForTests(): void {
  listeners.clear();
}
